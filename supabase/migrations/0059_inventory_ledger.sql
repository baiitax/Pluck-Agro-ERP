-- 0059 — inventory lots and the movement ledger
--
-- This file contains the single most important design decision of Phase 4: **there is no stock
-- column anywhere in this schema.** Quantity exists only as rows in `inventory_movements`, which is
-- append-only. Every balance, availability figure and reservation check in the system is a query over
-- that ledger. A table with a mutable `quantity_on_hand` eventually disagrees with its own movements,
-- and then nobody can say which number is true.
--
-- Consequences that follow from that decision, and are enforced here rather than hoped for:
--   * a correction is a compensating movement that references the original, never an UPDATE;
--   * every movement carries an idempotency key, so a retried consumer cannot double-post stock;
--   * a movement must name a lot, a product, a unit and a warehouse, and they must agree with the lot;
--   * a movement's sign is expressed as direction + positive quantity, so a negative quantity cannot
--     be used to smuggle an out-movement into an in-movement type;
--   * cost recorded on a movement is the cost stated by its source document. It is a fact, not a
--     valuation method; the system does not choose FIFO, weighted average or specific identification.

-- ---------------------------------------------------------------------------
-- 0. Lot lifecycle edges
-- ---------------------------------------------------------------------------
-- A lot's status describes whether it is still in ordinary use. It says nothing about quality: an
-- `open` lot may be on quality hold, and Phase 5 records that on its own tables, not here.

insert into public.inventory_status_transitions
  (entity_type, from_status, to_status, required_permission, requires_reason, description)
values
  ('inventory_lot', 'open', 'depleted', 'inventory.stock.manage', false, 'Nothing remains in the lot'),
  ('inventory_lot', 'open', 'closed', 'inventory.stock.manage', true, 'Lot closed before depletion'),
  ('inventory_lot', 'depleted', 'closed', 'inventory.stock.manage', false, 'Depleted lot archived')
on conflict (entity_type, from_status, to_status) do nothing;

-- ---------------------------------------------------------------------------
-- 1. Lots
-- ---------------------------------------------------------------------------
-- A lot is the identity of a quantity: what product, in which unit, sitting in which warehouse and
-- location, and where it came from. Quality disposition is NOT modelled here. Phase 5 owns quality
-- state; Phase 4 owns availability, and the two meet at `inventory_restrictions` (0060).

create table if not exists public.inventory_lots (
  id uuid primary key default gen_random_uuid(),
  lot_reference text not null,
  product_id uuid not null references public.products (id) on delete restrict on update cascade,
  unit_id uuid not null references public.units_of_measure (id) on delete restrict on update cascade,
  warehouse_id uuid not null references public.warehouses (id) on delete restrict on update cascade,
  location_id uuid references public.warehouse_locations (id) on delete restrict on update cascade,
  -- What created this lot. A lot always has a source; an invented lot with no source is untraceable.
  source_type text not null,
  source_id uuid,
  source_reference text,
  supplier_id uuid references public.suppliers (id) on delete set null on update cascade,
  goods_receipt_id uuid references public.goods_receipts (id) on delete set null on update cascade,
  -- Populated by 0066 once production batches exist; kept nullable so lots are not forced to have one.
  production_batch_id uuid,
  received_date date not null,
  manufacture_date date,
  expiry_date date,
  -- Free-text grading the factory uses (the gum arabic grades live in product master data, not here).
  grade text,
  status text not null default 'open',
  status_reason text,
  notes text,
  created_by uuid references public.profiles (id) on delete set null on update cascade,
  updated_by uuid references public.profiles (id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_lots_reference_unique unique (lot_reference),
  constraint inventory_lots_source_type_check
    check (source_type in ('goods_receipt', 'production_output', 'opening_balance', 'transfer_in',
                           'adjustment', 'customer_return', 'rework')),
  constraint inventory_lots_status_check
    check (status in ('open', 'depleted', 'closed')),
  constraint inventory_lots_expiry_after_manufacture
    check (expiry_date is null or manufacture_date is null or expiry_date >= manufacture_date)
);

create index if not exists inventory_lots_product_idx
  on public.inventory_lots (product_id, warehouse_id, status);
create index if not exists inventory_lots_warehouse_idx on public.inventory_lots (warehouse_id, status);
create index if not exists inventory_lots_receipt_idx on public.inventory_lots (goods_receipt_id);
create index if not exists inventory_lots_supplier_idx on public.inventory_lots (supplier_id);
create index if not exists inventory_lots_source_idx on public.inventory_lots (source_type, source_id);

comment on table public.inventory_lots is
  'The identity of a quantity: product, unit, warehouse, location and provenance. Holds no balance — quantity lives only in inventory_movements.';

-- ---------------------------------------------------------------------------
-- 2. The movement ledger
-- ---------------------------------------------------------------------------

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  movement_reference text not null,
  lot_id uuid not null references public.inventory_lots (id) on delete restrict on update cascade,
  product_id uuid not null references public.products (id) on delete restrict on update cascade,
  unit_id uuid not null references public.units_of_measure (id) on delete restrict on update cascade,
  warehouse_id uuid not null references public.warehouses (id) on delete restrict on update cascade,
  location_id uuid references public.warehouse_locations (id) on delete restrict on update cascade,

  movement_type text not null,
  -- Direction is explicit and the quantity is always positive. Storing a signed quantity in a typed
  -- column would let `receipt_in` carry a negative number and silently become an issue.
  direction text not null,
  quantity numeric(20, 6) not null,

  -- A reversal references the movement it corrects. Nothing is ever edited.
  reverses_movement_id uuid references public.inventory_movements (id) on delete restrict on update cascade,

  -- Idempotency: a consumer that retries (the GRN handoff does) writes the same key and gets the
  -- existing row instead of a second one.
  idempotency_key text not null,
  source_module text not null,
  source_type text not null,
  source_id uuid,
  source_reference text,
  transaction_id uuid,

  -- Cost as stated by the source document. A fact recorded at the time, not a valuation method.
  unit_cost numeric(20, 6),
  currency_code text,
  recorded_value numeric(20, 2),

  movement_date date not null,
  posted_at timestamptz not null default now(),
  posted_by uuid references public.profiles (id) on delete set null on update cascade,
  reason text,
  notes text,

  constraint inventory_movements_reference_unique unique (movement_reference),
  constraint inventory_movements_idempotency_unique unique (idempotency_key),
  constraint inventory_movements_quantity_positive check (quantity > 0),
  constraint inventory_movements_direction_check check (direction in ('in', 'out')),
  constraint inventory_movements_type_check
    check (movement_type in (
      -- purchasing
      'receipt_in', 'return_to_supplier',
      -- production
      'issue_to_production', 'production_output', 'by_product_output', 'waste_output',
      -- movement between warehouses
      'transfer_out', 'transfer_in',
      -- corrections
      'adjustment_in', 'adjustment_out', 'count_gain', 'count_loss', 'reversal',
      -- stock that predates the system, only ever entered through an approved import
      'opening_balance',
      -- other
      'customer_return', 'disposal', 'rework_in', 'rework_out'
    )),
  constraint inventory_movements_currency_format
    check (currency_code is null or currency_code ~ '^[A-Z]{3}$'),
  constraint inventory_movements_cost_non_negative check (unit_cost is null or unit_cost >= 0),
  constraint inventory_movements_value_sign
    check (recorded_value is null or (direction = 'in' and recorded_value >= 0)
                               or (direction = 'out' and recorded_value <= 0)),
  -- A reversal must not reverse itself, and a reversal direction must oppose the original. Both are
  -- checked by function rather than by constraint because they need the referenced row.
  constraint inventory_movements_no_self_reversal check (reverses_movement_id is null or reverses_movement_id <> id),
  constraint inventory_movements_reversal_type
    check ((movement_type = 'reversal') = (reverses_movement_id is not null)),
  -- A movement that leaves the company's control must say why.
  constraint inventory_movements_disposal_reason
    check (movement_type not in ('disposal', 'return_to_supplier', 'waste_output')
           or (reason is not null and length(btrim(reason)) >= 10))
);

create index if not exists inventory_movements_lot_idx on public.inventory_movements (lot_id, movement_date, posted_at);
create index if not exists inventory_movements_product_idx on public.inventory_movements (product_id, movement_date desc);
create index if not exists inventory_movements_warehouse_idx
  on public.inventory_movements (warehouse_id, movement_date desc);
create index if not exists inventory_movements_source_idx
  on public.inventory_movements (source_module, source_type, source_id);
create index if not exists inventory_movements_transaction_idx on public.inventory_movements (transaction_id);
create index if not exists inventory_movements_posted_idx on public.inventory_movements (posted_at desc);

comment on table public.inventory_movements is
  'Append-only stock ledger. The ONLY place a stock quantity exists. A correction is a compensating row that references the original; nothing is updated or deleted.';

-- ---------------------------------------------------------------------------
-- 3. Append-only enforcement
-- ---------------------------------------------------------------------------
-- A ledger that can be edited is not a ledger. This blocks UPDATE and DELETE even for a privileged
-- session, so the only way to change what the system believes is to post a new compensating movement
-- that a reader can see.

create or replace function private.block_inventory_movement_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'inventory_movements is append-only: post a compensating movement instead of updating or deleting a posted row'
    using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists inventory_movements_no_mutation on public.inventory_movements;
create trigger inventory_movements_no_mutation
  before update or delete on public.inventory_movements
  for each row execute function private.block_inventory_movement_mutation();

-- ---------------------------------------------------------------------------
-- 4. Movement validation
-- ---------------------------------------------------------------------------
-- Enforced in a trigger rather than a constraint because every rule here needs to read the lot row.

create or replace function private.validate_inventory_movement()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  lot public.inventory_lots;
  original public.inventory_movements;
begin
  select * into lot from public.inventory_lots where id = new.lot_id;
  if lot.id is null then
    raise exception 'Movement references a lot that does not exist' using errcode = 'check_violation';
  end if;

  -- The movement may not disagree with the lot about what it is or where it sits. Without this a
  -- movement could attribute stock to a warehouse the lot never entered, and the per-warehouse balance
  -- would be a fiction.
  if new.product_id <> lot.product_id then
    raise exception 'Movement product % does not match lot product %', new.product_id, lot.product_id
      using errcode = 'check_violation';
  end if;
  if new.unit_id <> lot.unit_id then
    raise exception 'Movement unit does not match the lot unit; convert the quantity before posting'
      using errcode = 'check_violation';
  end if;

  -- A lot belongs to one warehouse, so a movement against it must sit in that warehouse. A transfer
  -- therefore posts out of the source lot and creates a new lot at the destination: moving stock between
  -- warehouses moves its identity, and pretending a single lot spans two warehouses would make the
  -- per-warehouse balance meaningless.
  if new.warehouse_id <> lot.warehouse_id then
    raise exception 'Movement warehouse % does not match lot warehouse %: a transfer creates a lot at the destination',
      new.warehouse_id, lot.warehouse_id
      using errcode = 'check_violation';
  end if;

  if lot.status <> 'open' and new.movement_type not in ('adjustment_in', 'adjustment_out', 'count_gain', 'count_loss') then
    raise exception 'Lot % is %, so ordinary movements cannot be posted against it', lot.lot_reference, lot.status
      using errcode = 'check_violation';
  end if;

  if new.reverses_movement_id is not null then
    select * into original from public.inventory_movements where id = new.reverses_movement_id;
    if original.id is null then
      raise exception 'A reversal must reference an existing movement' using errcode = 'check_violation';
    end if;
    if original.direction = new.direction then
      raise exception 'A reversal must post in the opposite direction to the movement it reverses'
        using errcode = 'check_violation';
    end if;
    if original.movement_type = 'reversal' then
      raise exception 'A reversal of a reversal is not a correction; post a new movement instead'
        using errcode = 'check_violation';
    end if;
    if exists (
      select 1 from public.inventory_movements m
       where m.reverses_movement_id = original.id
    ) then
      raise exception 'Movement % has already been reversed', original.movement_reference
        using errcode = 'check_violation';
    end if;
    if new.quantity > original.quantity then
      raise exception 'A reversal cannot exceed the quantity of the movement it reverses (% %)',
        original.quantity, original.unit_id
        using errcode = 'check_violation';
    end if;
  end if;

  -- With lot tracking on, an untracked movement is refused. The setting exists so a future
  -- bulk-materials case could be configured, but the default is that everything is tracked.
  if new.lot_id is null and private.inventory_setting_boolean('lot_tracking_required') then
    raise exception 'Lot tracking is required: every movement must reference a lot'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists inventory_movements_validate on public.inventory_movements;
create trigger inventory_movements_validate
  before insert on public.inventory_movements
  for each row execute function private.validate_inventory_movement();

-- ---------------------------------------------------------------------------
-- 5. Negative-stock guard
-- ---------------------------------------------------------------------------
-- Enforced at insert time against the lot's derived balance, taking a lock on the lot row so two
-- concurrent out-movements cannot both read the same balance and both succeed. The database is the
-- only place this can be decided safely; a check in the browser is a suggestion.

create or replace function private.guard_inventory_negative_stock()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  balance numeric(20, 6);
  allow_negative boolean := private.inventory_setting_boolean('negative_stock_allowed');
begin
  if new.direction <> 'out' then
    return new;
  end if;

  -- Serialise concurrent postings against this lot.
  perform 1 from public.inventory_lots where id = new.lot_id for update;

  select coalesce(sum(case when m.direction = 'in' then m.quantity else -m.quantity end), 0)
    into balance
    from public.inventory_movements m
   where m.lot_id = new.lot_id;

  if not allow_negative and balance - new.quantity < 0 then
    raise exception 'Insufficient stock in lot: % % available, % % requested',
      balance, new.unit_id, new.quantity, new.unit_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists inventory_movements_negative_stock on public.inventory_movements;
create trigger inventory_movements_negative_stock
  before insert on public.inventory_movements
  for each row execute function private.guard_inventory_negative_stock();

-- ---------------------------------------------------------------------------
-- 6. Defaults: reference, document link and recorded value
-- ---------------------------------------------------------------------------

create or replace function private.set_inventory_movement_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.movement_reference is null or btrim(new.movement_reference) = '' then
    new.movement_reference := private.next_inventory_reference('inventory_movement');
  end if;

  if new.posted_by is null then
    new.posted_by := auth.uid();
  end if;

  -- Recorded value is derived from the stated cost and quantity where a cost exists. It is labelled
  -- "recorded" everywhere it is shown because it is not a valuation: no method has been applied.
  if new.recorded_value is null and new.unit_cost is not null then
    new.recorded_value := round(new.quantity * new.unit_cost, 2)
                          * case when new.direction = 'in' then 1 else -1 end;
  end if;

  return new;
end;
$$;

drop trigger if exists inventory_movements_set_defaults on public.inventory_movements;
create trigger inventory_movements_set_defaults
  before insert on public.inventory_movements
  for each row execute function private.set_inventory_movement_defaults();

-- Movement references come from their own counter (`inventory_movement`, prefix PA-MOV), not from the
-- lot counter: a lot and the movements that give it a balance are different document families, and
-- reusing one counter would make a lot's reference look like a movement's.

-- ---------------------------------------------------------------------------
-- 7. Derived balances
-- ---------------------------------------------------------------------------
-- Views, not tables. `security_invoker` so a caller sees only the rows their RLS policies allow.

create or replace view public.inventory_lot_balances
with (security_invoker = true)
as
select
  l.id as lot_id,
  l.lot_reference,
  l.product_id,
  p.code as product_code,
  p.name as product_name,
  l.unit_id,
  u.code as unit_code,
  l.warehouse_id,
  w.name as warehouse_name,
  l.location_id,
  l.status as lot_status,
  l.source_type,
  l.source_reference,
  l.supplier_id,
  l.goods_receipt_id,
  l.production_batch_id,
  l.received_date,
  l.expiry_date,
  coalesce(sum(case when m.direction = 'in' then m.quantity else -m.quantity end), 0) as on_hand_quantity,
  coalesce(sum(case when m.direction = 'in' then m.quantity end), 0) as total_in_quantity,
  coalesce(sum(case when m.direction = 'out' then m.quantity end), 0) as total_out_quantity,
  count(m.id) as movement_count,
  max(m.posted_at) as last_movement_at,
  -- Recorded cost only, and only where a cost was stated. Never presented as a valuation.
  coalesce(sum(m.recorded_value), 0) as recorded_value
from public.inventory_lots l
join public.products p on p.id = l.product_id
join public.units_of_measure u on u.id = l.unit_id
join public.warehouses w on w.id = l.warehouse_id
left join public.inventory_movements m on m.lot_id = l.id
group by l.id, p.code, p.name, u.code, w.name;

comment on view public.inventory_lot_balances is
  'Lot balances derived from the movement ledger on every read. `recorded_value` is the sum of costs stated on source documents and is NOT a valuation under any method.';

create or replace view public.inventory_product_balances
with (security_invoker = true)
as
select
  b.product_id,
  b.product_code,
  b.product_name,
  b.unit_id,
  b.unit_code,
  b.warehouse_id,
  b.warehouse_name,
  count(distinct b.lot_id) as lot_count,
  coalesce(sum(b.on_hand_quantity), 0) as on_hand_quantity,
  coalesce(sum(b.recorded_value), 0) as recorded_value
from public.inventory_lot_balances b
group by b.product_id, b.product_code, b.product_name, b.unit_id, b.unit_code,
         b.warehouse_id, b.warehouse_name;

comment on view public.inventory_product_balances is
  'Product-level balances per warehouse, derived from lot balances. Read-only; no table stores this.';

-- ---------------------------------------------------------------------------
-- 8. Ledger integrity view
-- ---------------------------------------------------------------------------
-- A self-checking view. If any row here ever appears non-zero, the ledger disagrees with itself and the
-- cause is a schema or trigger defect, not a business event.

create or replace view public.inventory_ledger_integrity
with (security_invoker = true)
as
select
  (select count(*) from public.inventory_movements m
    left join public.inventory_lots l on l.id = m.lot_id
    where l.id is null) as movements_without_lot,
  (select count(*) from public.inventory_movements m
    where m.direction not in ('in', 'out')) as movements_with_bad_direction,
  (select count(*) from public.inventory_movements m
    where m.quantity <= 0) as movements_with_non_positive_quantity,
  (select count(*) from public.inventory_movements m
    join public.inventory_movements r on r.reverses_movement_id = m.id
    where r.direction = m.direction) as reversals_in_wrong_direction,
  (select count(*) from public.inventory_lot_balances b
    where b.on_hand_quantity < 0) as lots_with_negative_balance,
  (select count(*) from (
     select lot_id from public.inventory_movements
     group by lot_id having count(*) <> count(distinct id)
   ) s) as lots_with_duplicate_movement_ids;

comment on view public.inventory_ledger_integrity is
  'Self-check on the ledger. Every column should be 0; anything else is a defect, not a business state.';

-- ---------------------------------------------------------------------------
-- 9. Timestamps on lots
-- ---------------------------------------------------------------------------

drop trigger if exists inventory_lots_set_updated_at on public.inventory_lots;
create trigger inventory_lots_set_updated_at
  before update on public.inventory_lots
  for each row execute function private.set_updated_at();

drop trigger if exists inventory_lots_status_guard on public.inventory_lots;
create trigger inventory_lots_status_guard
  before update on public.inventory_lots
  for each row execute function private.guard_inventory_status('inventory_lot', 'lot_reference');
