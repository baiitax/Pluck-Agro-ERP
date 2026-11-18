-- 0073 — let a dispatched transfer record its receipt
--
-- Defect this fixes. `0061` freezes a transfer's lines once the transfer leaves `draft`/`submitted`/`rejected`,
-- so that an approved transfer cannot be quietly re-specified. But `inventory_receive_transfer` has to write
-- `destination_lot_id` and `quantity_received` back onto each line, and it does so while the transfer is
-- `dispatched`. The guard therefore refused the receipt's own update: every transfer could be dispatched and
-- none could ever be received, leaving the stock permanently in transit.
--
-- The rule is narrowed rather than removed. While a transfer is in transit the receipt columns may be written;
-- everything that identifies or quantities the line — the transfer, the line number, the lot, the product, the
-- unit, the quantity, the notes — must still be byte-identical. Once the transfer is `received`, the lines are
-- frozen again, because that is now history.
--
-- Found by `tests/database/inventory.test.ts`, which is the permanent suite for Phase 4.

create or replace function private.guard_inventory_transfer_edit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  parent_status text;
  identification_unchanged boolean;
begin
  select status into parent_status
    from public.inventory_transfers
   where id = coalesce(new.transfer_id, old.transfer_id);

  -- No parent visible: leave the row alone. The foreign key is the real guard for that case.
  if parent_status is null then
    return coalesce(new, old);
  end if;

  if parent_status in ('draft', 'submitted', 'rejected') then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' and parent_status = 'dispatched' then
    identification_unchanged :=
          new.transfer_id = old.transfer_id
      and new.line_number = old.line_number
      and new.lot_id = old.lot_id
      and new.product_id = old.product_id
      and new.unit_id = old.unit_id
      and new.quantity = old.quantity
      and new.notes is not distinct from old.notes;

    if identification_unchanged then
      -- Only the receipt moved. This is the write `inventory_receive_transfer` makes.
      return new;
    end if;

    raise exception
      'Line % of transfer % is in transit: only the received quantity and destination lot may be recorded',
      old.line_number,
      (select reference from public.inventory_transfers where id = old.transfer_id)
      using errcode = 'check_violation';
  end if;

  raise exception 'Transfer lines cannot be changed once the transfer is %', parent_status
    using errcode = 'check_violation';
end;
$$;

comment on function private.guard_inventory_transfer_edit() is
  'Freezes a transfer line once approved. Permits only the receipt columns (quantity_received, destination_lot_id) while the transfer is in transit, and nothing at all once it is received.';

-- The guard is a trigger function; the trigger itself is unchanged and still points at this name.
revoke all on function private.guard_inventory_transfer_edit() from public;
