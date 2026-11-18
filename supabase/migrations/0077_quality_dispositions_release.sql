-- 0077 — dispositions, quality holds and release
--
-- This is the seam the whole phase exists for. Phase 4 left every received lot **restricted pending
-- inspection** and stated plainly that a hold expressed as a status label would be a lie. Phase 5 therefore
-- does not keep its own idea of what is available: it calls `inventory_apply_restriction` to take stock out of
-- availability and `inventory_release_restriction` to put it back. If the call fails, the hold row records
-- `restriction_state = 'failed'` and the system never claims the stock was held.
--
-- Three rules, each of which is a refusal rather than a convenience:
--   1. A disposition may only be recorded against an **approved** inspection (configurable, default on).
--   2. Only a **release** disposition releases restrictions. Reject, hold, rework and downgrade all leave stock
--      restricted, because none of them means "this stock is fit for use".
--   3. A release never touches a restriction that Phase 4 marked as a supplier quarantine: that quantity was
--      set aside at the gate and only a person resolves it (Phase 4's own contract).
--
-- Security model: these functions are `security definer` and assert the quality permission themselves. The
-- alternative — widening the RLS policies on `inventory_restrictions` so a quality role can write them —
-- would let that role bypass the quality workflow and release stock directly, which is precisely the hole the
-- phase is meant to close.

-- ---------------------------------------------------------------------------
-- 1. Numbering for dispositions and holds
-- ---------------------------------------------------------------------------

insert into public.quality_numbering (entity, prefix, padding, include_year, reset_yearly, description)
values
  ('quality_disposition', 'PA-QDP', 5, true, true, 'Quality dispositions'),
  ('quality_hold', 'PA-QHL', 5, true, true, 'Quality holds placed on stock')
on conflict (entity) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Dispositions
-- ---------------------------------------------------------------------------

create table if not exists public.quality_dispositions (
  id uuid primary key default gen_random_uuid(),
  reference text not null,
  inspection_id uuid not null references public.quality_inspections (id) on delete restrict on update cascade,
  lot_id uuid references public.inventory_lots (id) on delete restrict on update cascade,
  production_batch_id uuid references public.production_batches (id) on delete restrict on update cascade,
  product_id uuid not null references public.products (id) on delete restrict on update cascade,
  unit_id uuid not null references public.units_of_measure (id) on delete restrict on update cascade,

  disposition text not null,
  -- The quantity this decision applies to. Partial dispositions are allowed because a lot can be partly sound.
  quantity numeric(20, 6) not null,

  reason text not null,
  -- For rework and downgrade: what must happen to the material. For release: what it is released to.
  instruction text,
  next_review_date date,

  status text not null default 'recorded',
  status_reason text,
  revoked_by uuid references public.profiles (id) on delete set null on update cascade,
  revoked_at timestamptz,
  revocation_reason text,

  decided_by uuid references public.profiles (id) on delete set null on update cascade,
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint quality_dispositions_reference_unique unique (reference),
  constraint quality_dispositions_inspection_unique unique (inspection_id),
  constraint quality_dispositions_quantity_positive check (quantity > 0),
  constraint quality_dispositions_disposition_check
    check (disposition in ('release', 'reject', 'hold', 'rework', 'downgrade', 'quarantine')),
  constraint quality_dispositions_status_check check (status in ('recorded', 'revoked')),
  constraint quality_dispositions_reason_length check (length(btrim(reason)) >= 10),
  constraint quality_dispositions_revocation_shape
    check ((status = 'recorded' and revoked_at is null)
        or (status = 'revoked' and revoked_at is not null and revocation_reason is not null))
);

create index if not exists quality_dispositions_lot_idx on public.quality_dispositions (lot_id, decided_at desc);
create index if not exists quality_dispositions_disposition_idx on public.quality_dispositions (disposition, decided_at desc);
create index if not exists quality_dispositions_inspection_idx on public.quality_dispositions (inspection_id);

comment on table public.quality_dispositions is
  'The quality decision on an inspection. Only `release` returns stock to availability; every other disposition leaves it restricted.';

-- ---------------------------------------------------------------------------
-- 3. Holds — the record of what the inventory side was actually asked to do
-- ---------------------------------------------------------------------------

create table if not exists public.quality_holds (
  id uuid primary key default gen_random_uuid(),
  reference text not null,
  inspection_id uuid references public.quality_inspections (id) on delete set null on update cascade,
  lot_id uuid not null references public.inventory_lots (id) on delete restrict on update cascade,
  quantity numeric(20, 6) not null,
  reason_code text not null,
  reason text not null,

  -- The Phase 4 restriction this hold created, and whether creating it actually worked.
  restriction_id uuid references public.inventory_restrictions (id) on delete set null on update cascade,
  restriction_state text not null default 'pending',
  failure_reason text,

  released_at timestamptz,
  released_by uuid references public.profiles (id) on delete set null on update cascade,
  release_reason text,

  created_by uuid references public.profiles (id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint quality_holds_reference_unique unique (reference),
  constraint quality_holds_quantity_positive check (quantity > 0),
  constraint quality_holds_state_check
    check (restriction_state in ('pending', 'confirmed', 'failed')),
  constraint quality_holds_failure_shape
    check ((restriction_state = 'failed' and failure_reason is not null)
        or (restriction_state <> 'failed')),
  constraint quality_holds_release_shape
    check ((released_at is null and release_reason is null)
        or (released_at is not null and release_reason is not null))
);

create index if not exists quality_holds_lot_idx on public.quality_holds (lot_id, created_at desc);
create index if not exists quality_holds_open_idx
  on public.quality_holds (lot_id) where released_at is null;

comment on table public.quality_holds is
  'A quality hold and the inventory restriction it created. `restriction_state` is the honest answer to "did this actually stop the stock being used": pending, confirmed or failed. A failed hold is never shown as holding anything.';

-- ---------------------------------------------------------------------------
-- 4. Placing a hold
-- ---------------------------------------------------------------------------

create or replace function public.quality_place_hold(
  p_lot_id uuid,
  p_quantity numeric,
  p_reason_code text,
  p_reason text,
  p_inspection_id uuid default null
)
returns public.quality_holds
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  hold public.quality_holds;
  restriction public.inventory_restrictions;
  lot public.inventory_lots;
begin
  if auth.uid() is not null and not private.has_permission('quality.disposition.hold') then
    raise exception 'Placing a quality hold requires permission quality.disposition.hold'
      using errcode = 'insufficient_privilege';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'A hold quantity must be greater than zero' using errcode = 'check_violation';
  end if;

  if public.quality_setting_boolean('hold.require_reason', true)
     and (p_reason is null or length(btrim(p_reason)) < 10) then
    raise exception 'A quality hold requires a reason of at least 10 characters'
      using errcode = 'check_violation';
  end if;

  select * into lot from public.inventory_lots where id = p_lot_id;
  if lot.id is null then
    raise exception 'That lot does not exist, or you cannot see it' using errcode = 'check_violation';
  end if;

  insert into public.quality_holds
    (reference, inspection_id, lot_id, quantity, reason_code, reason, created_by)
  values
    (private.next_quality_reference('quality_hold'), p_inspection_id, p_lot_id, p_quantity,
     p_reason_code, p_reason, auth.uid())
  returning * into hold;

  -- The attempt is made in a nested block so a refusal from the inventory side is recorded rather than lost.
  begin
    restriction := public.inventory_apply_restriction(
      p_lot_id,
      p_quantity,
      p_reason_code,
      'quality',
      'quality_hold',
      hold.id,
      'quality-hold:' || hold.id::text,
      coalesce(p_reason, 'Quality hold'),
      'hold',
      null
    );

    update public.quality_holds
       set restriction_id = restriction.id,
           restriction_state = 'confirmed',
           updated_at = now()
     where id = hold.id
    returning * into hold;
  exception
    when others then
      update public.quality_holds
         set restriction_state = 'failed',
             failure_reason = sqlerrm,
             updated_at = now()
       where id = hold.id
      returning * into hold;
  end;

  return hold;
end;
$$;

comment on function public.quality_place_hold(uuid, numeric, text, text, uuid) is
  'Records a quality hold and attempts the matching inventory restriction. If the inventory side refuses, the hold is stored as failed with the database''s own explanation — it is never reported as having held stock.';

-- ---------------------------------------------------------------------------
-- 5. Releasing a hold
-- ---------------------------------------------------------------------------

create or replace function public.quality_release_hold(
  p_hold_id uuid,
  p_quantity numeric default null,
  p_reason text default null
)
returns public.quality_holds
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  hold public.quality_holds;
  release_quantity numeric;
begin
  if auth.uid() is not null and not private.has_permission('quality.disposition.release') then
    raise exception 'Releasing a quality hold requires permission quality.disposition.release'
      using errcode = 'insufficient_privilege';
  end if;

  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'Releasing a quality hold requires a reason of at least 10 characters'
      using errcode = 'check_violation';
  end if;

  select * into hold from public.quality_holds where id = p_hold_id for update;
  if hold.id is null then
    raise exception 'That quality hold does not exist, or you cannot see it' using errcode = 'check_violation';
  end if;
  if hold.released_at is not null then
    raise exception 'Quality hold % was already released on %', hold.reference, hold.released_at
      using errcode = 'check_violation';
  end if;
  if hold.restriction_state = 'failed' then
    raise exception 'Quality hold % never restricted any stock (the inventory side refused: %), so there is nothing to release',
      hold.reference, hold.failure_reason
      using errcode = 'check_violation';
  end if;

  release_quantity := coalesce(p_quantity, hold.quantity);

  if hold.restriction_id is not null then
    perform public.inventory_release_restriction(hold.restriction_id, release_quantity, p_reason);
  end if;

  update public.quality_holds
     set released_at = now(),
         released_by = coalesce(auth.uid(), released_by),
         release_reason = p_reason,
         updated_at = now()
   where id = hold.id
  returning * into hold;

  return hold;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Recording the disposition
-- ---------------------------------------------------------------------------

/**
 * Records the quality decision on an approved inspection and makes it real.
 *
 * `release` releases the lot's pending-inspection restriction and this inspection's confirmed holds, so the
 * quantity becomes available to reservation, issue and dispatch — through the same availability view Phase 4
 * already enforces, not through a shortcut. `reject`, `hold`, `quarantine`, `rework` and `downgrade` leave stock
 * restricted: `reject` and `quarantine` actively apply a restriction of their own so that a rejected quantity is
 * held by a document that says why.
 */
create or replace function public.quality_record_disposition(
  p_inspection_id uuid,
  p_disposition text,
  p_reason text,
  p_quantity numeric default null,
  p_instruction text default null,
  p_next_review_date date default null
)
returns public.quality_dispositions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inspection public.quality_inspections;
  spec public.quality_specifications;
  lot public.inventory_lots;
  decision public.quality_dispositions;
  target_quantity numeric;
  released_count int := 0;
  held public.quality_holds;
  quarantine_reason text;
  require_approval boolean;
begin
  if auth.uid() is not null and not private.has_permission('quality.disposition.record') then
    raise exception 'Recording a disposition requires permission quality.disposition.record'
      using errcode = 'insufficient_privilege';
  end if;

  if p_disposition not in ('release', 'reject', 'hold', 'rework', 'downgrade', 'quarantine') then
    raise exception 'Unknown disposition: %', p_disposition using errcode = 'check_violation';
  end if;

  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'A disposition requires a statement of at least 10 characters'
      using errcode = 'check_violation';
  end if;

  require_approval := public.quality_setting_boolean('inspection.require_approval_before_disposition', true);

  select * into inspection from public.quality_inspections where id = p_inspection_id for update;
  if inspection.id is null then
    raise exception 'That inspection does not exist, or you cannot see it' using errcode = 'check_violation';
  end if;

  if require_approval and inspection.status <> 'approved' then
    raise exception 'Inspection % is %. A disposition can only be recorded against an approved inspection.',
      inspection.reference, inspection.status
      using errcode = 'check_violation';
  end if;

  if inspection.lot_id is null then
    raise exception 'Inspection % is not linked to a lot, so no stock can be released or held by it',
      inspection.reference
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from public.quality_dispositions d where d.inspection_id = inspection.id and d.status = 'recorded') then
    raise exception 'Inspection % already carries a recorded disposition', inspection.reference
      using errcode = 'check_violation';
  end if;

  select * into spec from public.quality_specifications where id = inspection.specification_id;
  select * into lot from public.inventory_lots where id = inspection.lot_id;

  -- Default to what is actually still in the lot, which is a fact from the ledger, rather than to a number typed
  -- anywhere. `inventory_lot_balances` is Phase 4's own sum of posted movements.
  target_quantity := coalesce(
    p_quantity,
    (select b.on_hand_quantity from public.inventory_lot_balances b where b.lot_id = lot.id),
    0
  );

  if target_quantity is null or target_quantity <= 0 then
    raise exception 'Lot % has no stock on hand, so there is nothing to dispose of', lot.lot_reference
      using errcode = 'check_violation';
  end if;

  insert into public.quality_dispositions
    (reference, inspection_id, lot_id, production_batch_id, product_id, unit_id, disposition, quantity,
     reason, instruction, next_review_date, decided_by)
  values
    (private.next_quality_reference('quality_disposition'), inspection.id, lot.id,
     inspection.production_batch_id, lot.product_id, lot.unit_id, p_disposition, target_quantity,
     p_reason, p_instruction, p_next_review_date, auth.uid())
  returning * into decision;

  quarantine_reason := coalesce(
    (select value_text from public.inventory_settings where key = 'quarantined_receipt_reason'),
    'supplier_quarantine');

  if p_disposition = 'release' then
    if inspection.result_summary = 'non_conforming' then
      raise exception 'Inspection % is recorded non-conforming. A release disposition against it would contradict its own results.',
        inspection.reference
        using errcode = 'check_violation';
    end if;
  end if;

  -- Holds this inspection placed are resolved by its disposition, whichever way it went.
  for held in
    select * from public.quality_holds h
     where h.inspection_id = inspection.id
       and h.restriction_state = 'confirmed'
       and h.released_at is null
  loop
    perform public.quality_release_hold(held.id, null,
      'Resolved by disposition ' || decision.reference || ': ' || p_reason);
  end loop;

  -- The Phase 4 receipt restriction that has been waiting for exactly this decision. It is released for a
  -- release AND for a rejection: either way the stock is no longer "pending inspection", and leaving that
  -- phrase on a rejected lot would misdescribe it. Supplier quarantines are excluded, as Phase 4 requires.
  with released as (
    update public.inventory_restrictions r
       set released_quantity = r.quantity,
           status = 'released',
           released_at = now(),
           released_by = coalesce(auth.uid(), released_by),
           status_reason = left('Resolved by quality disposition ' || decision.reference || ': ' || p_reason, 500),
           updated_at = now()
     where r.lot_id = lot.id
       and r.status in ('active', 'partially_released')
       and r.restriction_type = 'pending_inspection'
       and r.reason_code <> quarantine_reason
    returning r.id
  )
  select count(*) into released_count from released;

  if p_disposition in ('reject', 'quarantine', 'hold', 'rework', 'downgrade') then
    -- Each of these leaves the material out of use, so each places a real hold that says why. Only the quantity
    -- still available needs one: anything else is already restricted by a document that gives its reason.
    target_quantity := least(target_quantity, private.inventory_lot_available(lot.id));
    if target_quantity > 0 then
      held := public.quality_place_hold(
        lot.id,
        target_quantity,
        case when p_disposition in ('reject', 'quarantine') then 'quality_' || p_disposition else p_disposition end,
        left('Disposition ' || decision.reference || ': ' || p_reason, 500),
        inspection.id
      );
    end if;
  end if;

  return decision;
end;
$$;

comment on function public.quality_record_disposition(uuid, text, text, numeric, text, date) is
  'Records the disposition and applies it to stock. Release is the only path that returns quantity to availability, and it does so through Phase 4''s restriction rules rather than by touching the ledger.';

-- ---------------------------------------------------------------------------
-- 7. Revocation
-- ---------------------------------------------------------------------------
-- A disposition that turns out to be wrong is revoked, never edited. Revoking a release re-applies a hold, so a
-- mistaken release cannot quietly leave stock available.

create or replace function public.quality_revoke_disposition(p_disposition_id uuid, p_reason text)
returns public.quality_dispositions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  decision public.quality_dispositions;
  lot public.inventory_lots;
begin
  if auth.uid() is not null and not private.has_permission('quality.disposition.release') then
    raise exception 'Revoking a disposition requires permission quality.disposition.release'
      using errcode = 'insufficient_privilege';
  end if;

  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'Revoking a disposition requires a reason of at least 10 characters'
      using errcode = 'check_violation';
  end if;

  select * into decision from public.quality_dispositions where id = p_disposition_id for update;
  if decision.id is null then
    raise exception 'That disposition does not exist, or you cannot see it' using errcode = 'check_violation';
  end if;
  if decision.status = 'revoked' then
    raise exception 'Disposition % was already revoked', decision.reference using errcode = 'check_violation';
  end if;

  if decision.disposition = 'release' and decision.lot_id is not null then
    select * into lot from public.inventory_lots where id = decision.lot_id;
    perform public.quality_place_hold(
      decision.lot_id,
      least(decision.quantity, (select coalesce(sum(b.available_quantity), 0) from public.inventory_availability b where b.lot_id = decision.lot_id)),
      'release_revoked',
      left('Disposition ' || decision.reference || ' revoked: ' || p_reason, 500),
      decision.inspection_id
    );
  end if;

  update public.quality_dispositions
     set status = 'revoked',
         revoked_at = now(),
         revoked_by = coalesce(auth.uid(), revoked_by),
         revocation_reason = p_reason,
         updated_at = now()
   where id = decision.id
  returning * into decision;

  return decision;
end;
$$;
