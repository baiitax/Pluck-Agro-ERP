-- 0064 — inventory row-level security and privileges
--
-- Posture, consistent with Phases 2 and 3:
--   * configuration tables are readable by any active profile, because forms need the numbering policy and
--     the lifecycle edges, and writable only with settings.system.manage;
--   * the ledger is readable with inventory.stock.view and appendable with inventory.stock.post. There is
--     deliberately NO update or delete policy: the append-only trigger would block it anyway, so the
--     absence of a policy is a second lock on the same door;
--   * child rows inherit parental visibility so a line can never be read when its document cannot;
--   * restrictions and reservations are readable with inventory.stock.view but only creatable and
--     releasable with their own permissions, because those two tables are what remove stock from use.
--     Phase 5 will add its own policies to these two tables for quality holds; it is deliberately not
--     anticipated here with permission codes that do not exist yet;
--   * the handoff record and the status trail are read-only to everyone: they are written by definer
--     functions and triggers.
--
-- Every table below has RLS enabled. Default deny: a table with no matching policy returns nothing.

-- ---------------------------------------------------------------------------
-- 1. Enable RLS
-- ---------------------------------------------------------------------------

alter table public.inventory_numbering enable row level security;
alter table public.inventory_status_transitions enable row level security;
alter table public.inventory_settings enable row level security;
alter table public.inventory_status_history enable row level security;
alter table public.inventory_lots enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.inventory_restrictions enable row level security;
alter table public.inventory_handoff_events enable row level security;
alter table public.inventory_transfers enable row level security;
alter table public.inventory_transfer_items enable row level security;
alter table public.inventory_reservations enable row level security;
alter table public.inventory_stock_counts enable row level security;
alter table public.inventory_stock_count_lines enable row level security;
alter table public.inventory_stock_adjustments enable row level security;
alter table public.inventory_stock_adjustment_lines enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Configuration
-- ---------------------------------------------------------------------------

drop policy if exists inventory_numbering_select on public.inventory_numbering;
create policy inventory_numbering_select on public.inventory_numbering
  for select to authenticated using (private.is_active_profile());

drop policy if exists inventory_numbering_write on public.inventory_numbering;
create policy inventory_numbering_write on public.inventory_numbering
  for all to authenticated
  using (private.has_permission('settings.system.manage'))
  with check (private.has_permission('settings.system.manage'));

drop policy if exists inventory_status_transitions_select on public.inventory_status_transitions;
create policy inventory_status_transitions_select on public.inventory_status_transitions
  for select to authenticated using (private.is_active_profile());

drop policy if exists inventory_status_transitions_write on public.inventory_status_transitions;
create policy inventory_status_transitions_write on public.inventory_status_transitions
  for all to authenticated
  using (private.has_permission('settings.system.manage'))
  with check (private.has_permission('settings.system.manage'));

drop policy if exists inventory_settings_select on public.inventory_settings;
create policy inventory_settings_select on public.inventory_settings
  for select to authenticated using (private.is_active_profile());

drop policy if exists inventory_settings_write on public.inventory_settings;
create policy inventory_settings_write on public.inventory_settings
  for all to authenticated
  using (private.has_permission('settings.system.manage'))
  with check (private.has_permission('settings.system.manage'));

-- ---------------------------------------------------------------------------
-- 3. The ledger
-- ---------------------------------------------------------------------------

drop policy if exists inventory_lots_select on public.inventory_lots;
create policy inventory_lots_select on public.inventory_lots
  for select to authenticated
  using (private.has_any_permission(array[
    'inventory.stock.view', 'inventory.lot.view', 'production.batch.view', 'quality.inspection.view'
  ]));

drop policy if exists inventory_lots_insert on public.inventory_lots;
create policy inventory_lots_insert on public.inventory_lots
  for insert to authenticated
  with check (private.has_any_permission(array['inventory.stock.manage', 'inventory.lot.create']));

drop policy if exists inventory_lots_update on public.inventory_lots;
create policy inventory_lots_update on public.inventory_lots
  for update to authenticated
  using (private.has_permission('inventory.stock.manage'))
  with check (private.has_permission('inventory.stock.manage'));

drop policy if exists inventory_movements_select on public.inventory_movements;
create policy inventory_movements_select on public.inventory_movements
  for select to authenticated
  using (private.has_any_permission(array[
    'inventory.stock.view', 'inventory.reports.view', 'quality.inspection.view'
  ]));

-- Posting a movement IS the privileged action; the append-only and validation triggers are what keep a
-- posted row honest. There is no update or delete policy, and the trigger refuses them regardless.
drop policy if exists inventory_movements_insert on public.inventory_movements;
create policy inventory_movements_insert on public.inventory_movements
  for insert to authenticated
  with check (private.has_any_permission(array['inventory.stock.post', 'production.batch.execute']));

drop policy if exists inventory_status_history_select on public.inventory_status_history;
create policy inventory_status_history_select on public.inventory_status_history
  for select to authenticated
  using (private.has_any_permission(array['inventory.stock.view', 'inventory.reports.view']));

-- ---------------------------------------------------------------------------
-- 4. Availability control: restrictions and reservations
-- ---------------------------------------------------------------------------

drop policy if exists inventory_restrictions_select on public.inventory_restrictions;
create policy inventory_restrictions_select on public.inventory_restrictions
  for select to authenticated
  using (private.has_any_permission(array['inventory.stock.view', 'inventory.restriction.view']));

drop policy if exists inventory_restrictions_insert on public.inventory_restrictions;
create policy inventory_restrictions_insert on public.inventory_restrictions
  for insert to authenticated
  with check (private.has_permission('inventory.restriction.manage'));

-- Releasing a restriction is an update to the row's release columns. It is a distinct permission from
-- creating one, because the person who may restrict stock is not necessarily the person who may free it.
drop policy if exists inventory_restrictions_update on public.inventory_restrictions;
create policy inventory_restrictions_update on public.inventory_restrictions
  for update to authenticated
  using (private.has_permission('inventory.restriction.release'))
  with check (private.has_permission('inventory.restriction.release'));

drop policy if exists inventory_reservations_select on public.inventory_reservations;
create policy inventory_reservations_select on public.inventory_reservations
  for select to authenticated
  using (private.has_any_permission(array[
    'inventory.stock.view', 'inventory.reservation.view', 'production.plan.view'
  ]));

drop policy if exists inventory_reservations_insert on public.inventory_reservations;
create policy inventory_reservations_insert on public.inventory_reservations
  for insert to authenticated
  with check (private.has_any_permission(array['inventory.reservation.manage', 'production.plan.execute']));

drop policy if exists inventory_reservations_update on public.inventory_reservations;
create policy inventory_reservations_update on public.inventory_reservations
  for update to authenticated
  using (private.has_permission('inventory.reservation.release'))
  with check (private.has_permission('inventory.reservation.release'));

-- ---------------------------------------------------------------------------
-- 5. Transfers
-- ---------------------------------------------------------------------------

drop policy if exists inventory_transfers_select on public.inventory_transfers;
create policy inventory_transfers_select on public.inventory_transfers
  for select to authenticated
  using (private.has_any_permission(array['inventory.transfer.view', 'inventory.stock.view']));

drop policy if exists inventory_transfers_insert on public.inventory_transfers;
create policy inventory_transfers_insert on public.inventory_transfers
  for insert to authenticated
  with check (private.has_permission('inventory.transfer.create'));

drop policy if exists inventory_transfers_update on public.inventory_transfers;
create policy inventory_transfers_update on public.inventory_transfers
  for update to authenticated
  using (private.has_any_permission(array['inventory.transfer.create', 'inventory.transfer.approve', 'inventory.transfer.execute']))
  with check (private.has_any_permission(array['inventory.transfer.create', 'inventory.transfer.approve', 'inventory.transfer.execute']));

drop policy if exists inventory_transfer_items_select on public.inventory_transfer_items;
create policy inventory_transfer_items_select on public.inventory_transfer_items
  for select to authenticated
  using (exists (
    select 1 from public.inventory_transfers t
     where t.id = inventory_transfer_items.transfer_id
       and private.has_any_permission(array['inventory.transfer.view', 'inventory.stock.view'])
  ));

drop policy if exists inventory_transfer_items_write on public.inventory_transfer_items;
create policy inventory_transfer_items_write on public.inventory_transfer_items
  for all to authenticated
  using (exists (
    select 1 from public.inventory_transfers t
     where t.id = inventory_transfer_items.transfer_id
       and private.has_permission('inventory.transfer.create')
  ))
  with check (exists (
    select 1 from public.inventory_transfers t
     where t.id = inventory_transfer_items.transfer_id
       and private.has_permission('inventory.transfer.create')
  ));

-- ---------------------------------------------------------------------------
-- 6. Counts and adjustments
-- ---------------------------------------------------------------------------

drop policy if exists inventory_stock_counts_select on public.inventory_stock_counts;
create policy inventory_stock_counts_select on public.inventory_stock_counts
  for select to authenticated
  using (private.has_any_permission(array['inventory.count.view', 'inventory.stock.view']));

drop policy if exists inventory_stock_counts_insert on public.inventory_stock_counts;
create policy inventory_stock_counts_insert on public.inventory_stock_counts
  for insert to authenticated
  with check (private.has_permission('inventory.count.execute'));

drop policy if exists inventory_stock_counts_update on public.inventory_stock_counts;
create policy inventory_stock_counts_update on public.inventory_stock_counts
  for update to authenticated
  using (private.has_any_permission(array['inventory.count.execute', 'inventory.count.approve']))
  with check (private.has_any_permission(array['inventory.count.execute', 'inventory.count.approve']));

drop policy if exists inventory_stock_count_lines_select on public.inventory_stock_count_lines;
create policy inventory_stock_count_lines_select on public.inventory_stock_count_lines
  for select to authenticated
  using (exists (
    select 1 from public.inventory_stock_counts c
     where c.id = inventory_stock_count_lines.count_id
       and private.has_any_permission(array['inventory.count.view', 'inventory.stock.view'])
  ));

drop policy if exists inventory_stock_count_lines_write on public.inventory_stock_count_lines;
create policy inventory_stock_count_lines_write on public.inventory_stock_count_lines
  for all to authenticated
  using (exists (
    select 1 from public.inventory_stock_counts c
     where c.id = inventory_stock_count_lines.count_id
       and private.has_permission('inventory.count.execute')
  ))
  with check (exists (
    select 1 from public.inventory_stock_counts c
     where c.id = inventory_stock_count_lines.count_id
       and private.has_permission('inventory.count.execute')
  ));

drop policy if exists inventory_stock_adjustments_select on public.inventory_stock_adjustments;
create policy inventory_stock_adjustments_select on public.inventory_stock_adjustments
  for select to authenticated
  using (private.has_any_permission(array['inventory.adjustment.view', 'inventory.stock.view']));

drop policy if exists inventory_stock_adjustments_insert on public.inventory_stock_adjustments;
create policy inventory_stock_adjustments_insert on public.inventory_stock_adjustments
  for insert to authenticated
  with check (private.has_permission('inventory.adjustment.create'));

drop policy if exists inventory_stock_adjustments_update on public.inventory_stock_adjustments;
create policy inventory_stock_adjustments_update on public.inventory_stock_adjustments
  for update to authenticated
  using (private.has_any_permission(array['inventory.adjustment.create', 'inventory.adjustment.approve']))
  with check (private.has_any_permission(array['inventory.adjustment.create', 'inventory.adjustment.approve']));

drop policy if exists inventory_stock_adjustment_lines_select on public.inventory_stock_adjustment_lines;
create policy inventory_stock_adjustment_lines_select on public.inventory_stock_adjustment_lines
  for select to authenticated
  using (exists (
    select 1 from public.inventory_stock_adjustments a
     where a.id = inventory_stock_adjustment_lines.adjustment_id
       and private.has_any_permission(array['inventory.adjustment.view', 'inventory.stock.view'])
  ));

drop policy if exists inventory_stock_adjustment_lines_write on public.inventory_stock_adjustment_lines;
create policy inventory_stock_adjustment_lines_write on public.inventory_stock_adjustment_lines
  for all to authenticated
  using (exists (
    select 1 from public.inventory_stock_adjustments a
     where a.id = inventory_stock_adjustment_lines.adjustment_id
       and private.has_permission('inventory.adjustment.create')
  ))
  with check (exists (
    select 1 from public.inventory_stock_adjustments a
     where a.id = inventory_stock_adjustment_lines.adjustment_id
       and private.has_permission('inventory.adjustment.create')
  ));

-- ---------------------------------------------------------------------------
-- 7. Handoff record — read-only evidence
-- ---------------------------------------------------------------------------

drop policy if exists inventory_handoff_events_select on public.inventory_handoff_events;
create policy inventory_handoff_events_select on public.inventory_handoff_events
  for select to authenticated
  using (private.has_any_permission(array[
    'inventory.stock.view', 'procurement.goods_receipt.view', 'inventory.reports.view'
  ]));

-- ---------------------------------------------------------------------------
-- 8. Table privileges
-- ---------------------------------------------------------------------------
-- RLS decides which rows; GRANT decides whether the table may be touched at all. Both are needed, and
-- both are stated explicitly so a missing grant fails loudly instead of returning an empty result.

grant select, insert, update on
  public.inventory_lots,
  public.inventory_transfers, public.inventory_transfer_items,
  public.inventory_stock_counts, public.inventory_stock_count_lines,
  public.inventory_stock_adjustments, public.inventory_stock_adjustment_lines,
  public.inventory_reservations
  to authenticated;

-- The ledger is append-and-read only. No update or delete grant exists on purpose.
grant select, insert on public.inventory_movements to authenticated;
grant select, insert, update on public.inventory_restrictions to authenticated;

grant select on
  public.inventory_numbering, public.inventory_status_transitions, public.inventory_settings,
  public.inventory_status_history, public.inventory_handoff_events
  to authenticated;

grant insert, update on
  public.inventory_numbering, public.inventory_status_transitions, public.inventory_settings
  to authenticated;

grant select on
  public.inventory_lot_balances, public.inventory_product_balances, public.inventory_availability,
  public.inventory_ledger_integrity, public.inventory_in_transit
  to authenticated;
