-- 0050 — procurement row-level security and privileges
--
-- Posture, consistent with Phase 2:
--   * configuration tables are readable by any active profile (forms need the numbering policy and
--     the lifecycle edges) and writable only with settings.system.manage;
--   * documents are readable only with the matching `.view` permission — except requisitions, which
--     are additionally visible to the employee who raised them and to holders of a
--     department-scoped grant;
--   * child rows inherit the visibility of their parent, so a line can never be read when its
--     document cannot;
--   * the sensitive disbursement table requires its own permission for SELECT, not just for writes;
--   * the append-only trails are readable by holders of the procurement audit permissions and
--     writable by nobody (triggers run as definer).
--
-- Every table below has RLS enabled. Default deny: a table with no matching policy returns nothing.

create or replace function private.has_any_permission(p_codes text[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(private.is_active_profile() and exists (
    select 1 from unnest(p_codes) as code
     where private.has_permission(code)
  ), false);
$$;

revoke all on function private.has_any_permission(text[]) from public;

-- Policies are evaluated with the *caller's* privileges, so the helper needs EXECUTE granted to the
-- roles that run queries. Without this every procurement policy fails closed with
-- "permission denied for function has_any_permission" instead of returning the permitted rows.
grant execute on function private.has_any_permission(text[]) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------------

alter table public.procurement_numbering enable row level security;
alter table public.procurement_status_transitions enable row level security;
alter table public.procurement_settings enable row level security;
alter table public.purchase_requisitions enable row level security;
alter table public.purchase_requisition_items enable row level security;
alter table public.purchase_requisition_allocations enable row level security;
alter table public.supplier_quotation_requests enable row level security;
alter table public.supplier_quotation_requests_suppliers enable row level security;
alter table public.supplier_quotations enable row level security;
alter table public.supplier_quotation_items enable row level security;
alter table public.supplier_quotation_comparisons enable row level security;
alter table public.supplier_quotation_comparison_quotes enable row level security;
alter table public.supplier_quotation_selections enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;
alter table public.purchase_order_requisition_links enable row level security;
alter table public.purchase_order_versions enable row level security;
alter table public.purchase_order_amendments enable row level security;
alter table public.purchase_order_amendment_items enable row level security;
alter table public.procurement_supplier_exceptions enable row level security;
alter table public.goods_receipts enable row level security;
alter table public.goods_receipt_items enable row level security;
alter table public.goods_receipt_inspections enable row level security;
alter table public.goods_receipt_postings enable row level security;
alter table public.supplier_advances enable row level security;
alter table public.supplier_advance_payment_details enable row level security;
alter table public.supplier_advance_applications enable row level security;
alter table public.supplier_transaction_references enable row level security;
alter table public.supplier_reconciliations enable row level security;
alter table public.supplier_reconciliation_items enable row level security;
alter table public.procurement_documents enable row level security;
alter table public.procurement_comments enable row level security;
alter table public.procurement_approvals enable row level security;
alter table public.procurement_status_history enable row level security;
alter table public.procurement_integration_outbox enable row level security;
alter table public.notifications enable row level security;
alter table public.procurement_legacy_imports enable row level security;
alter table public.procurement_legacy_import_rows enable row level security;

-- ---------------------------------------------------------------------------
-- Configuration
-- ---------------------------------------------------------------------------

drop policy if exists procurement_numbering_select on public.procurement_numbering;
create policy procurement_numbering_select on public.procurement_numbering
  for select to authenticated using (private.is_active_profile());

drop policy if exists procurement_numbering_write on public.procurement_numbering;
create policy procurement_numbering_write on public.procurement_numbering
  for all to authenticated
  using (private.has_permission('settings.system.manage'))
  with check (private.has_permission('settings.system.manage'));

drop policy if exists procurement_status_transitions_select on public.procurement_status_transitions;
create policy procurement_status_transitions_select on public.procurement_status_transitions
  for select to authenticated using (private.is_active_profile());

drop policy if exists procurement_status_transitions_write on public.procurement_status_transitions;
create policy procurement_status_transitions_write on public.procurement_status_transitions
  for all to authenticated
  using (private.has_permission('settings.system.manage'))
  with check (private.has_permission('settings.system.manage'));

drop policy if exists procurement_settings_select on public.procurement_settings;
create policy procurement_settings_select on public.procurement_settings
  for select to authenticated using (private.is_active_profile());

drop policy if exists procurement_settings_write on public.procurement_settings;
create policy procurement_settings_write on public.procurement_settings
  for all to authenticated
  using (private.has_permission('settings.system.manage'))
  with check (private.has_permission('settings.system.manage'));

-- ---------------------------------------------------------------------------
-- Requisitions
-- ---------------------------------------------------------------------------
-- A requisition belongs to a department. An employee always sees their own requests; a
-- department-scoped grant extends that to the whole department; a global grant sees all.

drop policy if exists purchase_requisitions_select on public.purchase_requisitions;
create policy purchase_requisitions_select on public.purchase_requisitions
  for select to authenticated
  using (
    private.is_active_profile()
    and (
      requesting_employee_id = private.current_employee_id()
      or private.has_scoped_permission('procurement.requisition.view', department_id)
      or private.has_permission('procurement.requisition.manage')
      or private.has_permission('procurement.requisition.approve')
    )
  );

drop policy if exists purchase_requisitions_insert on public.purchase_requisitions;
create policy purchase_requisitions_insert on public.purchase_requisitions
  for insert to authenticated
  with check (private.has_permission('procurement.requisition.create'));

drop policy if exists purchase_requisitions_update on public.purchase_requisitions;
create policy purchase_requisitions_update on public.purchase_requisitions
  for update to authenticated
  using (private.has_any_permission(array[
    'procurement.requisition.create', 'procurement.requisition.update',
    'procurement.requisition.submit', 'procurement.requisition.approve',
    'procurement.requisition.reject', 'procurement.requisition.cancel',
    'procurement.requisition.manage']))
  with check (private.has_any_permission(array[
    'procurement.requisition.create', 'procurement.requisition.update',
    'procurement.requisition.submit', 'procurement.requisition.approve',
    'procurement.requisition.reject', 'procurement.requisition.cancel',
    'procurement.requisition.manage']));

drop policy if exists purchase_requisition_items_select on public.purchase_requisition_items;
create policy purchase_requisition_items_select on public.purchase_requisition_items
  for select to authenticated
  using (exists (select 1 from public.purchase_requisitions r where r.id = requisition_id));

drop policy if exists purchase_requisition_items_write on public.purchase_requisition_items;
create policy purchase_requisition_items_write on public.purchase_requisition_items
  for all to authenticated
  using (private.has_any_permission(array['procurement.requisition.create', 'procurement.requisition.update']))
  with check (private.has_any_permission(array['procurement.requisition.create', 'procurement.requisition.update']));

drop policy if exists purchase_requisition_allocations_select on public.purchase_requisition_allocations;
create policy purchase_requisition_allocations_select on public.purchase_requisition_allocations
  for select to authenticated
  using (exists (
    select 1 from public.purchase_requisition_items i
     where i.id = requisition_item_id
       and exists (select 1 from public.purchase_requisitions r where r.id = i.requisition_id)));

drop policy if exists purchase_requisition_allocations_write on public.purchase_requisition_allocations;
create policy purchase_requisition_allocations_write on public.purchase_requisition_allocations
  for all to authenticated
  using (private.has_any_permission(array['procurement.purchase_order.create', 'procurement.requisition.manage']))
  with check (private.has_any_permission(array['procurement.purchase_order.create', 'procurement.requisition.manage']));

-- ---------------------------------------------------------------------------
-- Quotations
-- ---------------------------------------------------------------------------

drop policy if exists supplier_quotation_requests_select on public.supplier_quotation_requests;
create policy supplier_quotation_requests_select on public.supplier_quotation_requests
  for select to authenticated using (private.has_permission('procurement.quotation.view'));

drop policy if exists supplier_quotation_requests_write on public.supplier_quotation_requests;
create policy supplier_quotation_requests_write on public.supplier_quotation_requests
  for all to authenticated
  using (private.has_permission('procurement.quotation.create'))
  with check (private.has_permission('procurement.quotation.create'));

drop policy if exists supplier_quotation_requests_suppliers_select on public.supplier_quotation_requests_suppliers;
create policy supplier_quotation_requests_suppliers_select on public.supplier_quotation_requests_suppliers
  for select to authenticated using (private.has_permission('procurement.quotation.view'));

drop policy if exists supplier_quotation_requests_suppliers_write on public.supplier_quotation_requests_suppliers;
create policy supplier_quotation_requests_suppliers_write on public.supplier_quotation_requests_suppliers
  for all to authenticated
  using (private.has_permission('procurement.quotation.create'))
  with check (private.has_permission('procurement.quotation.create'));

drop policy if exists supplier_quotations_select on public.supplier_quotations;
create policy supplier_quotations_select on public.supplier_quotations
  for select to authenticated using (private.has_permission('procurement.quotation.view'));

drop policy if exists supplier_quotations_insert on public.supplier_quotations;
create policy supplier_quotations_insert on public.supplier_quotations
  for insert to authenticated with check (private.has_permission('procurement.quotation.create'));

drop policy if exists supplier_quotations_update on public.supplier_quotations;
create policy supplier_quotations_update on public.supplier_quotations
  for update to authenticated
  using (private.has_any_permission(array['procurement.quotation.create', 'procurement.quotation.update',
                                          'procurement.quotation.compare', 'procurement.quotation.select']))
  with check (private.has_any_permission(array['procurement.quotation.create', 'procurement.quotation.update',
                                               'procurement.quotation.compare', 'procurement.quotation.select']));

drop policy if exists supplier_quotation_items_select on public.supplier_quotation_items;
create policy supplier_quotation_items_select on public.supplier_quotation_items
  for select to authenticated
  using (exists (select 1 from public.supplier_quotations q where q.id = quotation_id));

drop policy if exists supplier_quotation_items_write on public.supplier_quotation_items;
create policy supplier_quotation_items_write on public.supplier_quotation_items
  for all to authenticated
  using (private.has_any_permission(array['procurement.quotation.create', 'procurement.quotation.update']))
  with check (private.has_any_permission(array['procurement.quotation.create', 'procurement.quotation.update']));

drop policy if exists supplier_quotation_comparisons_select on public.supplier_quotation_comparisons;
create policy supplier_quotation_comparisons_select on public.supplier_quotation_comparisons
  for select to authenticated using (private.has_permission('procurement.quotation.view'));

drop policy if exists supplier_quotation_comparisons_write on public.supplier_quotation_comparisons;
create policy supplier_quotation_comparisons_write on public.supplier_quotation_comparisons
  for all to authenticated
  using (private.has_permission('procurement.quotation.compare'))
  with check (private.has_permission('procurement.quotation.compare'));

drop policy if exists supplier_quotation_comparison_quotes_select on public.supplier_quotation_comparison_quotes;
create policy supplier_quotation_comparison_quotes_select on public.supplier_quotation_comparison_quotes
  for select to authenticated using (private.has_permission('procurement.quotation.view'));

drop policy if exists supplier_quotation_comparison_quotes_write on public.supplier_quotation_comparison_quotes;
create policy supplier_quotation_comparison_quotes_write on public.supplier_quotation_comparison_quotes
  for all to authenticated
  using (private.has_permission('procurement.quotation.compare'))
  with check (private.has_permission('procurement.quotation.compare'));

drop policy if exists supplier_quotation_selections_select on public.supplier_quotation_selections;
create policy supplier_quotation_selections_select on public.supplier_quotation_selections
  for select to authenticated using (private.has_permission('procurement.quotation.view'));

drop policy if exists supplier_quotation_selections_insert on public.supplier_quotation_selections;
create policy supplier_quotation_selections_insert on public.supplier_quotation_selections
  for insert to authenticated with check (private.has_permission('procurement.quotation.select'));

-- ---------------------------------------------------------------------------
-- Purchase orders
-- ---------------------------------------------------------------------------

drop policy if exists purchase_orders_select on public.purchase_orders;
create policy purchase_orders_select on public.purchase_orders
  for select to authenticated using (private.has_permission('procurement.purchase_order.view'));

drop policy if exists purchase_orders_insert on public.purchase_orders;
create policy purchase_orders_insert on public.purchase_orders
  for insert to authenticated with check (private.has_permission('procurement.purchase_order.create'));

drop policy if exists purchase_orders_update on public.purchase_orders;
create policy purchase_orders_update on public.purchase_orders
  for update to authenticated
  using (private.has_any_permission(array[
    'procurement.purchase_order.create', 'procurement.purchase_order.update',
    'procurement.purchase_order.submit', 'procurement.purchase_order.approve',
    'procurement.purchase_order.issue', 'procurement.purchase_order.amend',
    'procurement.purchase_order.cancel', 'procurement.purchase_order.close',
    'procurement.goods_receipt.post']))
  with check (private.has_any_permission(array[
    'procurement.purchase_order.create', 'procurement.purchase_order.update',
    'procurement.purchase_order.submit', 'procurement.purchase_order.approve',
    'procurement.purchase_order.issue', 'procurement.purchase_order.amend',
    'procurement.purchase_order.cancel', 'procurement.purchase_order.close',
    'procurement.goods_receipt.post']));

drop policy if exists purchase_order_items_select on public.purchase_order_items;
create policy purchase_order_items_select on public.purchase_order_items
  for select to authenticated
  using (exists (select 1 from public.purchase_orders po where po.id = purchase_order_id));

drop policy if exists purchase_order_items_write on public.purchase_order_items;
create policy purchase_order_items_write on public.purchase_order_items
  for all to authenticated
  using (private.has_any_permission(array['procurement.purchase_order.create', 'procurement.purchase_order.update',
                                          'procurement.purchase_order.amend']))
  with check (private.has_any_permission(array['procurement.purchase_order.create', 'procurement.purchase_order.update',
                                               'procurement.purchase_order.amend']));

drop policy if exists purchase_order_requisition_links_select on public.purchase_order_requisition_links;
create policy purchase_order_requisition_links_select on public.purchase_order_requisition_links
  for select to authenticated
  using (exists (select 1 from public.purchase_orders po where po.id = purchase_order_id));

drop policy if exists purchase_order_requisition_links_write on public.purchase_order_requisition_links;
create policy purchase_order_requisition_links_write on public.purchase_order_requisition_links
  for all to authenticated
  using (private.has_any_permission(array['procurement.purchase_order.create', 'procurement.purchase_order.update']))
  with check (private.has_any_permission(array['procurement.purchase_order.create', 'procurement.purchase_order.update']));

drop policy if exists purchase_order_versions_select on public.purchase_order_versions;
create policy purchase_order_versions_select on public.purchase_order_versions
  for select to authenticated using (private.has_permission('procurement.purchase_order.view'));

drop policy if exists purchase_order_amendments_select on public.purchase_order_amendments;
create policy purchase_order_amendments_select on public.purchase_order_amendments
  for select to authenticated using (private.has_permission('procurement.purchase_order.view'));

drop policy if exists purchase_order_amendments_write on public.purchase_order_amendments;
create policy purchase_order_amendments_write on public.purchase_order_amendments
  for all to authenticated
  using (private.has_any_permission(array['procurement.purchase_order.amend', 'procurement.purchase_order.approve']))
  with check (private.has_any_permission(array['procurement.purchase_order.amend', 'procurement.purchase_order.approve']));

drop policy if exists purchase_order_amendment_items_select on public.purchase_order_amendment_items;
create policy purchase_order_amendment_items_select on public.purchase_order_amendment_items
  for select to authenticated
  using (exists (select 1 from public.purchase_order_amendments a where a.id = amendment_id));

drop policy if exists purchase_order_amendment_items_write on public.purchase_order_amendment_items;
create policy purchase_order_amendment_items_write on public.purchase_order_amendment_items
  for all to authenticated
  using (private.has_any_permission(array['procurement.purchase_order.amend', 'procurement.purchase_order.approve']))
  with check (private.has_any_permission(array['procurement.purchase_order.amend', 'procurement.purchase_order.approve']));

drop policy if exists procurement_supplier_exceptions_select on public.procurement_supplier_exceptions;
create policy procurement_supplier_exceptions_select on public.procurement_supplier_exceptions
  for select to authenticated using (private.has_permission('procurement.purchase_order.view'));

drop policy if exists procurement_supplier_exceptions_write on public.procurement_supplier_exceptions;
create policy procurement_supplier_exceptions_write on public.procurement_supplier_exceptions
  for all to authenticated
  using (private.has_permission('procurement.purchase_order.approve'))
  with check (private.has_permission('procurement.purchase_order.approve'));

-- ---------------------------------------------------------------------------
-- Goods receipts
-- ---------------------------------------------------------------------------

drop policy if exists goods_receipts_select on public.goods_receipts;
create policy goods_receipts_select on public.goods_receipts
  for select to authenticated using (private.has_permission('procurement.goods_receipt.view'));

drop policy if exists goods_receipts_insert on public.goods_receipts;
create policy goods_receipts_insert on public.goods_receipts
  for insert to authenticated with check (private.has_permission('procurement.goods_receipt.create'));

drop policy if exists goods_receipts_update on public.goods_receipts;
create policy goods_receipts_update on public.goods_receipts
  for update to authenticated
  using (private.has_any_permission(array[
    'procurement.goods_receipt.create', 'procurement.goods_receipt.update',
    'procurement.goods_receipt.submit', 'procurement.goods_receipt.review',
    'procurement.goods_receipt.approve', 'procurement.goods_receipt.post',
    'procurement.goods_receipt.cancel']))
  with check (private.has_any_permission(array[
    'procurement.goods_receipt.create', 'procurement.goods_receipt.update',
    'procurement.goods_receipt.submit', 'procurement.goods_receipt.review',
    'procurement.goods_receipt.approve', 'procurement.goods_receipt.post',
    'procurement.goods_receipt.cancel']));

drop policy if exists goods_receipt_items_select on public.goods_receipt_items;
create policy goods_receipt_items_select on public.goods_receipt_items
  for select to authenticated
  using (exists (select 1 from public.goods_receipts gr where gr.id = goods_receipt_id));

drop policy if exists goods_receipt_items_write on public.goods_receipt_items;
create policy goods_receipt_items_write on public.goods_receipt_items
  for all to authenticated
  using (private.has_any_permission(array['procurement.goods_receipt.create', 'procurement.goods_receipt.update']))
  with check (private.has_any_permission(array['procurement.goods_receipt.create', 'procurement.goods_receipt.update']));

drop policy if exists goods_receipt_inspections_select on public.goods_receipt_inspections;
create policy goods_receipt_inspections_select on public.goods_receipt_inspections
  for select to authenticated using (private.has_permission('procurement.goods_receipt.view'));

drop policy if exists goods_receipt_inspections_write on public.goods_receipt_inspections;
create policy goods_receipt_inspections_write on public.goods_receipt_inspections
  for all to authenticated
  using (private.has_any_permission(array['procurement.goods_receipt.create', 'procurement.goods_receipt.review']))
  with check (private.has_any_permission(array['procurement.goods_receipt.create', 'procurement.goods_receipt.review']));

drop policy if exists goods_receipt_postings_select on public.goods_receipt_postings;
create policy goods_receipt_postings_select on public.goods_receipt_postings
  for select to authenticated using (private.has_permission('procurement.goods_receipt.view'));

-- ---------------------------------------------------------------------------
-- Supplier advances, payments, ledger, reconciliation
-- ---------------------------------------------------------------------------

drop policy if exists supplier_advances_select on public.supplier_advances;
create policy supplier_advances_select on public.supplier_advances
  for select to authenticated using (private.has_permission('procurement.supplier_advance.view'));

drop policy if exists supplier_advances_insert on public.supplier_advances;
create policy supplier_advances_insert on public.supplier_advances
  for insert to authenticated with check (private.has_permission('procurement.supplier_advance.create'));

drop policy if exists supplier_advances_update on public.supplier_advances;
create policy supplier_advances_update on public.supplier_advances
  for update to authenticated
  using (private.has_any_permission(array['procurement.supplier_advance.create', 'procurement.supplier_advance.submit',
                                          'procurement.supplier_advance.approve']))
  with check (private.has_any_permission(array['procurement.supplier_advance.create', 'procurement.supplier_advance.submit',
                                               'procurement.supplier_advance.approve']));

drop policy if exists supplier_advance_payment_details_sensitive on public.supplier_advance_payment_details;
create policy supplier_advance_payment_details_sensitive on public.supplier_advance_payment_details
  for all to authenticated
  using (private.has_permission('procurement.supplier_advance_payment.view'))
  with check (private.has_permission('procurement.supplier_advance_payment.manage'));

drop policy if exists supplier_advance_applications_select on public.supplier_advance_applications;
create policy supplier_advance_applications_select on public.supplier_advance_applications
  for select to authenticated
  using (exists (select 1 from public.supplier_advances a where a.id = advance_id));

drop policy if exists supplier_advance_applications_write on public.supplier_advance_applications;
create policy supplier_advance_applications_write on public.supplier_advance_applications
  for all to authenticated
  using (private.has_any_permission(array['procurement.supplier_advance.approve', 'procurement.reconciliation.manage']))
  with check (private.has_any_permission(array['procurement.supplier_advance.approve', 'procurement.reconciliation.manage']));

drop policy if exists supplier_transaction_references_select on public.supplier_transaction_references;
create policy supplier_transaction_references_select on public.supplier_transaction_references
  for select to authenticated
  using (private.has_any_permission(array['procurement.reconciliation.view', 'procurement.supplier_advance.view']));

drop policy if exists supplier_transaction_references_write on public.supplier_transaction_references;
create policy supplier_transaction_references_write on public.supplier_transaction_references
  for all to authenticated
  using (private.has_permission('procurement.reconciliation.manage'))
  with check (private.has_permission('procurement.reconciliation.manage'));

drop policy if exists supplier_reconciliations_select on public.supplier_reconciliations;
create policy supplier_reconciliations_select on public.supplier_reconciliations
  for select to authenticated using (private.has_permission('procurement.reconciliation.view'));

drop policy if exists supplier_reconciliations_write on public.supplier_reconciliations;
create policy supplier_reconciliations_write on public.supplier_reconciliations
  for all to authenticated
  using (private.has_permission('procurement.reconciliation.manage'))
  with check (private.has_permission('procurement.reconciliation.manage'));

drop policy if exists supplier_reconciliation_items_select on public.supplier_reconciliation_items;
create policy supplier_reconciliation_items_select on public.supplier_reconciliation_items
  for select to authenticated
  using (exists (select 1 from public.supplier_reconciliations r where r.id = reconciliation_id));

drop policy if exists supplier_reconciliation_items_write on public.supplier_reconciliation_items;
create policy supplier_reconciliation_items_write on public.supplier_reconciliation_items
  for all to authenticated
  using (private.has_permission('procurement.reconciliation.manage'))
  with check (private.has_permission('procurement.reconciliation.manage'));

-- ---------------------------------------------------------------------------
-- Support tables
-- ---------------------------------------------------------------------------

drop policy if exists procurement_documents_select on public.procurement_documents;
create policy procurement_documents_select on public.procurement_documents
  for select to authenticated using (private.has_permission('procurement.document.view'));

drop policy if exists procurement_documents_write on public.procurement_documents;
create policy procurement_documents_write on public.procurement_documents
  for all to authenticated
  using (private.has_permission('procurement.document.upload'))
  with check (private.has_permission('procurement.document.upload'));

drop policy if exists procurement_comments_select on public.procurement_comments;
create policy procurement_comments_select on public.procurement_comments
  for select to authenticated
  using (private.has_any_permission(array['procurement.requisition.view', 'procurement.quotation.view',
                                          'procurement.purchase_order.view', 'procurement.goods_receipt.view',
                                          'procurement.supplier_advance.view', 'procurement.reconciliation.view']));

drop policy if exists procurement_comments_insert on public.procurement_comments;
create policy procurement_comments_insert on public.procurement_comments
  for insert to authenticated
  with check (private.has_any_permission(array['procurement.purchase_order.create', 'procurement.requisition.create',
                                               'procurement.goods_receipt.create', 'procurement.quotation.create']));

drop policy if exists procurement_approvals_select on public.procurement_approvals;
create policy procurement_approvals_select on public.procurement_approvals
  for select to authenticated
  using (private.has_any_permission(array['procurement.approval.view', 'procurement.purchase_order.approve',
                                          'procurement.requisition.approve', 'procurement.goods_receipt.approve',
                                          'procurement.supplier_advance.approve']));

drop policy if exists procurement_status_history_select on public.procurement_status_history;
create policy procurement_status_history_select on public.procurement_status_history
  for select to authenticated
  using (private.has_any_permission(array['procurement.approval.view', 'governance.audit.view']));

drop policy if exists procurement_integration_outbox_select on public.procurement_integration_outbox;
create policy procurement_integration_outbox_select on public.procurement_integration_outbox
  for select to authenticated using (private.has_permission('procurement.reports.view'));

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated using (recipient_profile_id = auth.uid());

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update to authenticated
  using (recipient_profile_id = auth.uid())
  with check (recipient_profile_id = auth.uid());

drop policy if exists procurement_legacy_imports_select on public.procurement_legacy_imports;
create policy procurement_legacy_imports_select on public.procurement_legacy_imports
  for select to authenticated using (private.has_permission('procurement.legacy.view'));

drop policy if exists procurement_legacy_imports_write on public.procurement_legacy_imports;
create policy procurement_legacy_imports_write on public.procurement_legacy_imports
  for all to authenticated
  using (private.has_permission('procurement.legacy.manage'))
  with check (private.has_permission('procurement.legacy.manage'));

drop policy if exists procurement_legacy_import_rows_select on public.procurement_legacy_import_rows;
create policy procurement_legacy_import_rows_select on public.procurement_legacy_import_rows
  for select to authenticated using (private.has_permission('procurement.legacy.view'));

drop policy if exists procurement_legacy_import_rows_write on public.procurement_legacy_import_rows;
create policy procurement_legacy_import_rows_write on public.procurement_legacy_import_rows
  for all to authenticated
  using (private.has_permission('procurement.legacy.manage'))
  with check (private.has_permission('procurement.legacy.manage'));

-- ---------------------------------------------------------------------------
-- Table privileges
-- ---------------------------------------------------------------------------
-- RLS filters rows; grants decide whether the statement is permitted at all. Both are required:
-- a table that is not granted is invisible even to a policy-holding user.

grant select on public.procurement_numbering, public.procurement_status_transitions,
  public.procurement_settings to authenticated;
grant insert, update, delete on public.procurement_numbering, public.procurement_status_transitions,
  public.procurement_settings to authenticated;

grant select, insert, update, delete on
  public.purchase_requisitions, public.purchase_requisition_items, public.purchase_requisition_allocations,
  public.supplier_quotation_requests, public.supplier_quotation_requests_suppliers,
  public.supplier_quotations, public.supplier_quotation_items,
  public.supplier_quotation_comparisons, public.supplier_quotation_comparison_quotes,
  public.supplier_quotation_selections,
  public.purchase_orders, public.purchase_order_items, public.purchase_order_requisition_links,
  public.purchase_order_amendments, public.purchase_order_amendment_items,
  public.procurement_supplier_exceptions,
  public.goods_receipts, public.goods_receipt_items, public.goods_receipt_inspections,
  public.supplier_advances, public.supplier_advance_payment_details, public.supplier_advance_applications,
  public.supplier_transaction_references, public.supplier_reconciliations, public.supplier_reconciliation_items,
  public.procurement_documents, public.procurement_comments,
  public.procurement_legacy_imports, public.procurement_legacy_import_rows
  to authenticated;

-- Append-only tables get SELECT only; their rows arrive through trigger or definer functions.
grant select on
  public.purchase_order_versions, public.goods_receipt_postings, public.procurement_approvals,
  public.procurement_status_history to authenticated;

grant select, update on public.notifications to authenticated;
grant select on public.procurement_integration_outbox to authenticated;

grant select on
  public.purchase_requisition_fulfilment, public.purchase_order_receipt_status, public.purchase_order_summary,
  public.supplier_quotation_comparison_view, public.supplier_ledger, public.supplier_balances,
  public.report_requisition_register, public.report_purchase_order_register,
  public.report_outstanding_deliveries, public.report_goods_receipt_register,
  public.report_receipt_discrepancies, public.report_quotation_comparison,
  public.report_supplier_advances, public.report_supplier_procurement,
  public.report_procurement_expenditure, public.report_approval_turnaround,
  public.procurement_data_quality
  to authenticated;
