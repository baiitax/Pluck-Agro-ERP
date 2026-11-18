-- 0070 — production execution
--
-- The four functions that actually run the factory. Everything here obeys one rule: stock changes only by
-- inserting a movement, and every derived figure is recomputed from posted movements afterwards.
--
--   production_start_batch       — take a plan (or nothing) and open a running batch
--   production_issue_material    — take stock out of a lot and attribute it to the batch
--   production_record_output     — create the output lot, add it to stock, restrict it pending inspection
--   production_close_batch       — reconcile, record the observed yield, close
--
-- `production_close_batch` computes yield as recorded output ÷ recorded input *for the same batch*, and only
-- when input and output share a unit. That is arithmetic on facts the batch itself recorded; it is not a
-- yield model, and nothing here predicts what a batch should produce.

-- ---------------------------------------------------------------------------
-- 1. Start a batch
-- ---------------------------------------------------------------------------

/**
 * Opens a running production batch, optionally against an approved plan.
 *
 * A plan supplies the product, quantity and output warehouse; a standalone batch must state them. Starting
 * moves the plan to `in_progress` on the same transaction, so a plan cannot quietly sit approved while its
 * work is under way elsewhere.
 */
create or replace function public.production_start_batch(
  p_plan_id uuid default null,
  p_product_id uuid default null,
  p_planned_quantity numeric default null,
  p_unit_id uuid default null,
  p_warehouse_id uuid default null,
  p_batch_date date default null,
  p_supervisor_employee_id uuid default null,
  p_notes text default null
)
returns public.production_batches
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  plan public.production_plans;
  created public.production_batches;
begin
  if p_plan_id is not null then
    select * into plan from public.production_plans where id = p_plan_id for update;
    if plan.id is null then
      raise exception 'That production plan does not exist, or you cannot see it' using errcode = 'check_violation';
    end if;
    if plan.status <> 'approved' then
      raise exception 'Plan % is %; a batch can only start from an approved plan', plan.reference, plan.status
        using errcode = 'check_violation';
    end if;
    if p_product_id is not null and p_product_id <> plan.product_id then
      raise exception 'The batch product must match plan % product', plan.reference using errcode = 'check_violation';
    end if;

    insert into public.production_batches
      (plan_id, product_id, unit_id, warehouse_id, planned_quantity, status, batch_date,
       started_at, supervisor_employee_id, notes, created_by)
    values
      (plan.id, plan.product_id, plan.unit_id, plan.warehouse_id, plan.planned_quantity, 'in_progress',
       coalesce(p_batch_date, current_date), now(), p_supervisor_employee_id, p_notes, auth.uid())
    returning * into created;

    update public.production_plans
       set status = 'in_progress', started_at = coalesce(started_at, now()),
           batch_count = batch_count + 1, updated_by = auth.uid()
     where id = plan.id;
  else
    if p_product_id is null or p_planned_quantity is null or p_unit_id is null or p_warehouse_id is null then
      raise exception 'A batch without a plan needs a product, quantity, unit and warehouse'
        using errcode = 'check_violation';
    end if;
    if p_planned_quantity <= 0 then
      raise exception 'A planned batch quantity must be greater than zero' using errcode = 'check_violation';
    end if;

    insert into public.production_batches
      (product_id, unit_id, warehouse_id, planned_quantity, status, batch_date,
       started_at, supervisor_employee_id, notes, created_by)
    values
      (p_product_id, p_unit_id, p_warehouse_id, p_planned_quantity, 'in_progress',
       coalesce(p_batch_date, current_date), now(), p_supervisor_employee_id, p_notes, auth.uid())
    returning * into created;
  end if;

  return created;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Issue material
-- ---------------------------------------------------------------------------

/**
 * Takes material out of a lot and attributes it to a running batch.
 *
 * Refusals, in order of how much they matter:
 *   * the batch must be running;
 *   * the lot must hold at least the requested quantity *available* — i.e. not restricted and not promised
 *     to something else, which is the whole point of the availability view;
 *   * with `production_issue_requires_stock` on (the default) an over-issue is refused, not clamped.
 *
 * After the movement is posted, any reservation this plan held on that lot is released by the issued
 * quantity, because the stock has now left. Without that release, issuing twice would double-count the
 * claim and the remaining availability would be understated for ever.
 */
create or replace function public.production_issue_material(
  p_batch_id uuid,
  p_lot_id uuid,
  p_quantity numeric,
  p_notes text default null
)
returns public.production_batch_materials
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  batch public.production_batches;
  lot public.inventory_lots;
  available numeric;
  line_no int;
  movement_id uuid;
  created public.production_batch_materials;
  reservation record;
  to_release numeric;
  requires_stock boolean := private.inventory_setting_boolean('production_issue_requires_stock');
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'An issue quantity must be greater than zero' using errcode = 'check_violation';
  end if;

  select * into batch from public.production_batches where id = p_batch_id for update;
  if batch.id is null then
    raise exception 'That production batch does not exist, or you cannot see it' using errcode = 'check_violation';
  end if;
  if batch.status <> 'in_progress' then
    raise exception 'Batch % is %, so material cannot be issued to it', batch.reference, batch.status
      using errcode = 'check_violation';
  end if;

  select * into lot from public.inventory_lots where id = p_lot_id for update;
  if lot.id is null then
    raise exception 'That lot does not exist, or you cannot see it' using errcode = 'check_violation';
  end if;
  if lot.warehouse_id <> batch.warehouse_id then
    raise exception 'Lot % is held in %, but batch % draws from %',
      lot.lot_reference,
      (select name from public.warehouses where id = lot.warehouse_id),
      batch.reference,
      (select name from public.warehouses where id = batch.warehouse_id)
      using errcode = 'check_violation';
  end if;

  available := private.inventory_lot_available(p_lot_id);
  if requires_stock and p_quantity > available then
    raise exception 'Cannot issue % of lot %: only % is available (on hand less restrictions and reservations)',
      p_quantity, lot.lot_reference, available
      using errcode = 'check_violation';
  end if;

  select coalesce(max(line_number), 0) + 1 into line_no
    from public.production_batch_materials where batch_id = batch.id;

  insert into public.inventory_movements
    (lot_id, product_id, unit_id, warehouse_id, location_id, movement_type, direction, quantity,
     idempotency_key, source_module, source_type, source_id, source_reference, transaction_id,
     movement_date, posted_by, reason, notes)
  values
    (lot.id, lot.product_id, lot.unit_id, lot.warehouse_id, lot.location_id,
     'issue_to_production', 'out', p_quantity,
     'batch-issue:' || batch.id::text || ':' || line_no::text,
     'production', 'production_batch', batch.id, batch.reference, batch.id,
     batch.batch_date, auth.uid(),
     'Issued to production batch ' || batch.reference, p_notes)
  returning id into movement_id;

  insert into public.production_batch_materials
    (batch_id, line_number, lot_id, product_id, unit_id, quantity, movement_id, issued_by, notes)
  values
    (batch.id, line_no, lot.id, lot.product_id, lot.unit_id, p_quantity, movement_id, auth.uid(), p_notes)
  returning * into created;

  -- Release whatever this batch's plan had claimed on the lot, up to what was just issued.
  to_release := p_quantity;
  if batch.plan_id is not null then
    for reservation in
      select * from public.inventory_reservations
       where reserved_for_module = 'production'
         and reserved_for_type = 'production_plan'
         and reserved_for_id = batch.plan_id
         and lot_id = lot.id
         and status in ('active', 'partially_released')
       order by created_at
    loop
      exit when to_release <= 0;
      declare
        remaining numeric := reservation.quantity - reservation.released_quantity;
        release_now numeric := least(remaining, to_release);
      begin
        perform public.inventory_release_reservation(
          reservation.id, release_now, 'Issued to production batch ' || batch.reference
        );
        to_release := to_release - release_now;
      end;
    end loop;
  end if;

  return created;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Record output
-- ---------------------------------------------------------------------------

/**
 * Records produced output: creates the lot, adds it to stock, and holds it pending quality inspection.
 *
 * The lot is created here rather than by the caller so that output can never enter stock without provenance.
 * When `production_output_requires_inspection` is on (the default) and the output is not waste, a real
 * `pending_inspection` restriction is applied through the Phase 5 seam, which is why the restriction id is
 * stored on the output line: that is the row Quality will release, and its identifier is what makes the
 * release verifiable rather than asserted.
 */
create or replace function public.production_record_output(
  p_batch_id uuid,
  p_quantity numeric,
  p_output_type text default 'main',
  p_product_id uuid default null,
  p_unit_id uuid default null,
  p_location_id uuid default null,
  p_manufacture_date date default null,
  p_expiry_date date default null,
  p_grade text default null,
  p_notes text default null
)
returns public.production_batch_outputs
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  batch public.production_batches;
  out_product uuid;
  out_unit uuid;
  out_warehouse uuid;
  lot_id uuid;
  lot_reference text;
  movement_id uuid;
  restriction public.inventory_restrictions;
  line_no int;
  created public.production_batch_outputs;
  requires_inspection boolean := private.inventory_setting_boolean('production_output_requires_inspection');
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'An output quantity must be greater than zero' using errcode = 'check_violation';
  end if;
  if p_output_type not in ('main', 'by_product', 'waste') then
    raise exception 'Output type must be main, by_product or waste' using errcode = 'check_violation';
  end if;

  select * into batch from public.production_batches where id = p_batch_id for update;
  if batch.id is null then
    raise exception 'That production batch does not exist, or you cannot see it' using errcode = 'check_violation';
  end if;
  if batch.status <> 'in_progress' then
    raise exception 'Batch % is %, so output cannot be recorded against it', batch.reference, batch.status
      using errcode = 'check_violation';
  end if;

  -- A main output is the batch product. A by-product or waste must be named; guessing would put an unnamed
  -- substance into stock.
  if p_output_type = 'main' then
    out_product := batch.product_id;
    out_unit := batch.unit_id;
  else
    if p_product_id is null then
      raise exception 'A % output must name the product it produced', p_output_type
        using errcode = 'check_violation';
    end if;
    out_product := p_product_id;
    out_unit := coalesce(p_unit_id, (select base_unit_id from public.products where id = p_product_id));
  end if;
  out_warehouse := batch.warehouse_id;

  -- The lot reference comes from the numbering series, like every other lot: a hand-typed one would let two
  -- lots share a label and destroy traceability.
  lot_reference := private.next_inventory_reference('inventory_lot');

  insert into public.inventory_lots
    (lot_reference, product_id, unit_id, warehouse_id, location_id, source_type, source_id, source_reference,
     production_batch_id, received_date, manufacture_date, expiry_date, grade, notes, created_by)
  values
    (lot_reference, out_product, out_unit, out_warehouse, coalesce(p_location_id, batch.location_id),
     'production_output', batch.id, batch.reference,
     batch.id, batch.batch_date, coalesce(p_manufacture_date, batch.batch_date), p_expiry_date,
     p_grade, 'Output of production batch ' || batch.reference, auth.uid())
  returning id into lot_id;

  select coalesce(max(line_number), 0) + 1 into line_no
    from public.production_batch_outputs where batch_id = batch.id;

  insert into public.inventory_movements
    (lot_id, product_id, unit_id, warehouse_id, location_id, movement_type, direction, quantity,
     idempotency_key, source_module, source_type, source_id, source_reference, transaction_id,
     movement_date, posted_by, reason, notes)
  values
    (lot_id, out_product, out_unit, out_warehouse, coalesce(p_location_id, batch.location_id),
     case p_output_type
       when 'main' then 'production_output'
       when 'by_product' then 'by_product_output'
       else 'waste_output'
     end,
     'in', p_quantity,
     'batch-output:' || batch.id::text || ':' || line_no::text,
     'production', 'production_batch', batch.id, batch.reference, batch.id,
     batch.batch_date, auth.uid(),
     'Output of production batch ' || batch.reference, p_notes)
  returning id into movement_id;

  insert into public.production_batch_outputs
    (batch_id, line_number, output_type, product_id, unit_id, lot_id, quantity, movement_id,
     recorded_by, notes)
  values
    (batch.id, line_no, p_output_type, out_product, out_unit, lot_id, p_quantity, movement_id,
     auth.uid(), p_notes)
  returning * into created;

  if requires_inspection and p_output_type <> 'waste' then
    restriction := public.inventory_apply_restriction(
      lot_id,
      p_quantity,
      'pending_inspection',
      'production',
      'production_batch',
      batch.id,
      'batch-output-inspection:' || batch.id::text || ':' || line_no::text,
      'Production output awaits quality inspection',
      'pending_inspection'
    );

    update public.production_batch_outputs
       set restriction_id = restriction.id
     where id = created.id
    returning * into created;
  end if;

  return created;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Close a batch
-- ---------------------------------------------------------------------------

/**
 * Reconciles a completed batch and closes it.
 *
 * Yield is computed only when the issued material and the main output share a unit; otherwise the batch is
 * marked `mixed_units` and no percentage is stated, because dividing grammes by litres would invent a
 * number. When a declared band exists and the recorded yield falls outside it — or when no band exists at
 * all — a stated reason of at least 10 characters is required to close.
 *
 * Completing and closing are two steps on purpose: completion is "we have recorded everything", closing is
 * "a supervisor has reconciled it", and the lifecycle in 0058 requires different permissions for each.
 */
create or replace function public.production_close_batch(
  p_batch_id uuid,
  p_reason text default null,
  p_output_location_id uuid default null
)
returns public.production_batches
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  batch public.production_batches;
  rule public.production_yield_rules;
  input_total numeric(20, 6);
  output_total numeric(20, 6);
  same_unit boolean;
  yield_pct numeric(7, 3);
  outside_band boolean := false;
  needs_reason boolean := false;
begin
  select * into batch from public.production_batches where id = p_batch_id for update;
  if batch.id is null then
    raise exception 'That production batch does not exist, or you cannot see it' using errcode = 'check_violation';
  end if;
  if batch.status = 'closed' then
    return batch;
  end if;
  if batch.status not in ('in_progress', 'completed') then
    raise exception 'Batch % is %, so it cannot be closed', batch.reference, batch.status
      using errcode = 'check_violation';
  end if;

  if not exists (select 1 from public.production_batch_materials where batch_id = batch.id) then
    raise exception 'Batch % has no issued material, so there is nothing to reconcile', batch.reference
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.production_batch_outputs where batch_id = batch.id) then
    raise exception 'Batch % has recorded no output', batch.reference using errcode = 'check_violation';
  end if;

  select coalesce(sum(m.quantity), 0),
         coalesce(bool_and(m.unit_id = batch.unit_id), true)
    into input_total, same_unit
    from public.production_batch_materials m
   where m.batch_id = batch.id;

  select coalesce(sum(o.quantity), 0) into output_total
    from public.production_batch_outputs o
   where o.batch_id = batch.id and o.output_type = 'main' and o.unit_id = batch.unit_id;

  select * into rule
    from public.production_yield_rules r
   where r.product_id = batch.product_id
     and r.is_active
     and r.effective_from <= batch.batch_date
     and (r.effective_to is null or r.effective_to >= batch.batch_date)
   order by r.effective_from desc
   limit 1;

  if same_unit and input_total > 0 and (rule.id is null or rule.basis = 'output_over_input') then
    yield_pct := round((output_total / input_total) * 100, 3);
  end if;

  if rule.id is null then
    -- No declared band: the system will not pretend a yield is normal or abnormal. It records the figure and
    -- requires a human to say what they think of it.
    needs_reason := true;
  else
    if yield_pct is not null then
      outside_band := (rule.min_percent is not null and yield_pct < rule.min_percent)
                   or (rule.max_percent is not null and yield_pct > rule.max_percent);
    else
      outside_band := true;
    end if;
    needs_reason := outside_band and rule.requires_reason_outside_band;
  end if;

  if needs_reason and (p_reason is null or length(btrim(p_reason)) < 10) then
    if rule.id is null then
      raise exception 'No yield band is declared for this product, so closing batch % requires a stated reason of at least 10 characters',
        batch.reference using errcode = 'check_violation';
    end if;
    raise exception 'Recorded yield of % is outside the declared band for this product; closing batch % requires a stated reason',
      coalesce(yield_pct::text, 'unknown'), batch.reference
      using errcode = 'check_violation';
  end if;

  -- Completing first is a distinct lifecycle edge and needs its own permission.
  if batch.status = 'in_progress' then
    update public.production_batches
       set status = 'completed', completed_at = coalesce(completed_at, now()), updated_by = auth.uid()
     where id = batch.id;
  end if;

  update public.production_batches
     set status = 'closed',
         closed_at = now(),
         closed_by = auth.uid(),
         recorded_yield_percent = yield_pct,
         recorded_yield_basis = case when yield_pct is null then 'mixed_units' else 'same_unit' end,
         within_declared_band = case when rule.id is null then null else not outside_band end,
         status_reason = coalesce(p_reason, status_reason),
         updated_by = auth.uid()
   where id = batch.id
  returning * into batch;

  if batch.plan_id is not null then
    update public.production_plans p
       set produced_quantity = p.produced_quantity + output_total,
           status = case
             when p.produced_quantity + output_total >= p.planned_quantity then 'completed'
             else p.status
           end,
           completed_at = case
             when p.produced_quantity + output_total >= p.planned_quantity then now()
             else p.completed_at
           end,
           updated_by = auth.uid()
     where p.id = batch.plan_id
       and p.status in ('approved', 'in_progress');
  end if;

  return batch;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Log entry
-- ---------------------------------------------------------------------------

create or replace function public.production_log_batch(
  p_batch_id uuid,
  p_body text,
  p_log_type text default 'note',
  p_shift text default null,
  p_stage_id uuid default null
)
returns public.production_batch_logs
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  created public.production_batch_logs;
begin
  if not exists (select 1 from public.production_batches where id = p_batch_id) then
    raise exception 'That production batch does not exist, or you cannot see it' using errcode = 'check_violation';
  end if;

  insert into public.production_batch_logs
    (batch_id, body, log_type, shift, stage_id, employee_id, created_by)
  values
    (p_batch_id, p_body, p_log_type, p_shift, p_stage_id, private.current_employee_id(), auth.uid())
  returning * into created;

  return created;
end;
$$;

comment on function public.production_start_batch(uuid, uuid, numeric, uuid, uuid, date, uuid, text) is
  'Opens a running batch, from an approved plan or standalone.';
comment on function public.production_issue_material(uuid, uuid, numeric, text) is
  'Posts issue_to_production out of a lot and records the batch line. Releases the plan''s own reservation by the issued quantity.';
comment on function public.production_record_output(uuid, numeric, text, uuid, uuid, uuid, date, date, text, text) is
  'Creates the output lot, posts production_output in, and holds it pending inspection through the Phase 5 seam.';
comment on function public.production_close_batch(uuid, text, uuid) is
  'Reconciles a batch and records the observed yield. Requires a stated reason when no band is declared or the yield falls outside it.';

grant execute on function public.production_start_batch(uuid, uuid, numeric, uuid, uuid, date, uuid, text) to authenticated;
grant execute on function public.production_issue_material(uuid, uuid, numeric, text) to authenticated;
grant execute on function public.production_record_output(uuid, numeric, text, uuid, uuid, uuid, date, date, text, text) to authenticated;
grant execute on function public.production_close_batch(uuid, text, uuid) to authenticated;
grant execute on function public.production_log_batch(uuid, text, text, text, uuid) to authenticated;
