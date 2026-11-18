#!/usr/bin/env python3
"""Generates `types/database.types.ts` from the SQL migrations.

No hosted Supabase project is linked, so `supabase gen types` cannot run. Hand-maintaining the
type file for 77 tables and 20 views invites drift, so it is generated here instead — the same
principle the permission seeds follow.

What is derived (never hand-written):
  * one `TableDef` per `create table` in every migration, in migration order;
  * columns added later with `alter table ... add column if not exists`;
  * the `Database` shape, the RPC signatures of the transactional functions, and the row type
    aliases the application imports.

What is declared explicitly below, because SQL alone does not say it:
  * `COLUMN_TYPE_OVERRIDES` — a handful of text columns whose application-level type is a union
    (an employment status is not "any string");
  * `VIEW_ROWS` — the row shape of each view the application reads. Views are declared rather than
    parsed because a `select` projection is not a schema.

Run:  python3 scripts/generate-database-types.py
"""

import glob
import re

TYPE_MAP = [
    (r'^uuid', 'string'),
    (r'^timestamptz', 'string'),
    (r'^date', 'string'),
    (r'^time', 'string'),
    (r'^text', 'string'),
    (r'^boolean', 'boolean'),
    (r'^bigint', 'number'),
    (r'^int', 'number'),
    (r'^numeric', 'number'),
    (r'^jsonb', 'Json'),
    (r'^json', 'Json'),
    (r'^inet', 'string'),
]

# Continuation lines of multi-line CHECK constraints are not columns.
SKIP_PREFIXES = ('constraint ', 'primary key', 'unique (', 'foreign key', 'check (', 'and ', 'or ')

COLUMN_TYPE_OVERRIDES = {
    ('employees', 'employment_status'): 'EmploymentStatus',
    ('profiles', 'account_status'): 'AccountStatus',
    ('roles', 'category'): 'RoleCategory',
    ('role_permissions', 'scope_type'): 'PermissionScopeName',
    ('approval_authorities', 'scope_type'): 'PermissionScopeName',
    ('approval_limits', 'scope_type'): 'PermissionScopeName',
    ('approval_delegations', 'status'): 'DelegationStatus',
    ('segregation_of_duties_rules', 'enforcement_level'): 'SodEnforcement',
    ('access_review_records', 'status'): 'ReviewStatus',
    ('access_review_records', 'decision'): 'ReviewDecision',
    ('audit_logs', 'event_category'): 'AuditCategory',
    ('audit_logs', 'severity'): 'AuditSeverity',
    ('master_data_import_jobs', 'status'): 'ImportJobStatus',
}

VIEW_ROWS = {
    'purchase_requisition_fulfilment': [
        ('requisition_id', 'string', False), ('reference', 'string', False), ('status', 'string', False),
        ('department_id', 'string', False), ('requesting_employee_id', 'string', False),
        ('required_delivery_date', 'string', False), ('line_count', 'number', False),
        ('requested_quantity', 'number', False), ('allocated_quantity', 'number', False),
        ('outstanding_quantity', 'number', False),
    ],
    'purchase_order_receipt_status': [
        ('purchase_order_item_id', 'string', False), ('purchase_order_id', 'string', False),
        ('product_id', 'string', False), ('ordered_quantity', 'number', False),
        ('received_quantity', 'number', False), ('accepted_quantity', 'number', False),
        ('rejected_quantity', 'number', False), ('quarantined_quantity', 'number', False),
        ('outstanding_quantity', 'number', False),
    ],
    'purchase_order_summary': [
        ('purchase_order_id', 'string', False), ('reference', 'string', False), ('supplier_id', 'string', False),
        ('supplier_name_snapshot', 'string', False), ('status', 'string', False),
        ('currency_code', 'string', False), ('total_amount', 'number', False), ('order_date', 'string', False),
        ('expected_delivery_date', 'string', True), ('issued_at', 'string', True), ('department_id', 'string', True),
        ('line_count', 'number', False), ('ordered_quantity', 'number', False), ('received_quantity', 'number', False),
        ('outstanding_quantity', 'number', False), ('rejected_quantity', 'number', False),
        ('quarantined_quantity', 'number', False), ('is_overdue', 'boolean', False),
    ],
    'supplier_quotation_comparison_view': [
        ('comparison_id', 'string', False), ('quotation_id', 'string', False),
        ('quotation_reference', 'string', False), ('supplier_id', 'string', False),
        ('supplier_name', 'string', False), ('supplier_status', 'string', False),
        ('verification_status', 'string', False), ('total_at_comparison', 'number', False),
        ('currency_code', 'string', False), ('lead_time_days_at_comparison', 'number', True),
        ('validity_at_comparison', 'string', True), ('payment_terms_snapshot', 'string', True),
        ('delivery_terms_snapshot', 'string', True), ('quotation_status', 'string', False),
        ('is_lowest_price', 'boolean', False),
    ],
    'supplier_ledger': [
        ('supplier_id', 'string', False), ('activity_type', 'string', False), ('activity_id', 'string', False),
        ('activity_reference', 'string', False), ('activity_date', 'string', False),
        ('amount', 'number', True), ('currency_code', 'string', False), ('status', 'string', False),
    ],
    'supplier_balances': [
        ('supplier_id', 'string', False), ('legal_name', 'string', False), ('reference', 'string', False),
        ('supplier_status', 'string', False), ('currency_code', 'string', False),
        ('ordered_amount', 'number', False),
        ('received_value', 'number', False), ('invoiced_amount', 'number', False),
        ('paid_amount', 'number', False), ('advance_balance', 'number', False),
        ('confirmed_payable', 'number', True), ('unreconciled_difference', 'number', True),
    ],
    'report_requisition_register': [
        ('id', 'string', False), ('reference', 'string', False), ('status', 'string', False),
        ('priority', 'string', False), ('requisition_date', 'string', False),
        ('required_delivery_date', 'string', False), ('estimated_total', 'number', True),
        ('currency_code', 'string', False), ('department_name', 'string', True),
        ('requesting_employee', 'string', True), ('line_count', 'number', False),
        ('requested_quantity', 'number', False), ('allocated_quantity', 'number', False),
        ('outstanding_quantity', 'number', False), ('submitted_at', 'string', True),
        ('approved_at', 'string', True), ('approval_hours', 'number', True),
    ],
    'report_purchase_order_register': [
        ('id', 'string', False), ('reference', 'string', False), ('status', 'string', False),
        ('supplier_id', 'string', False), ('supplier_name', 'string', False), ('order_date', 'string', False),
        ('expected_delivery_date', 'string', True), ('issued_at', 'string', True),
        ('currency_code', 'string', False), ('total_amount', 'number', False), ('line_count', 'number', False),
        ('ordered_quantity', 'number', False), ('received_quantity', 'number', False),
        ('outstanding_quantity', 'number', False), ('rejected_quantity', 'number', False),
        ('quarantined_quantity', 'number', False), ('is_overdue', 'boolean', False),
        ('department_id', 'string', True), ('department_name', 'string', True),
        ('received_percent', 'number', True),
    ],
    'report_outstanding_deliveries': [
        ('id', 'string', False), ('reference', 'string', False), ('supplier_name', 'string', False),
        ('status', 'string', False), ('expected_delivery_date', 'string', True),
        ('outstanding_quantity', 'number', False), ('currency_code', 'string', False),
        ('is_overdue', 'boolean', False), ('days_past_expected', 'number', True),
    ],
    'report_goods_receipt_register': [
        ('id', 'string', False), ('reference', 'string', False), ('status', 'string', False),
        ('receipt_date', 'string', False), ('supplier_delivery_note_number', 'string', True),
        ('delivery_reference', 'string', True), ('inspection_status', 'string', False),
        ('purchase_order_reference', 'string', False), ('supplier_name', 'string', False),
        ('warehouse_name', 'string', True), ('location_name', 'string', True),
        ('posting_reference', 'string', True), ('posted_at', 'string', True), ('line_count', 'number', False),
        ('received_quantity', 'number', False), ('accepted_quantity', 'number', False),
        ('rejected_quantity', 'number', False), ('quarantined_quantity', 'number', False),
    ],
    'report_receipt_discrepancies': [
        ('goods_receipt_id', 'string', False), ('reference', 'string', False), ('receipt_date', 'string', False),
        ('purchase_order_reference', 'string', False), ('supplier_name', 'string', False),
        ('line_number', 'number', False), ('product_name', 'string', False),
        ('received_quantity', 'number', False), ('accepted_quantity', 'number', False),
        ('rejected_quantity', 'number', False), ('quarantined_quantity', 'number', False),
        ('rejection_reason', 'string', True), ('is_excess_delivery', 'boolean', False),
        ('is_short_delivery', 'boolean', False),
    ],
    'report_quotation_comparison': [
        ('comparison_id', 'string', False), ('comparison_title', 'string', False),
        ('comparison_date', 'string', False), ('quotation_id', 'string', False),
        ('quotation_reference', 'string', False), ('supplier_name', 'string', False),
        ('supplier_status', 'string', False), ('verification_status', 'string', False),
        ('total_at_comparison', 'number', False), ('currency_code', 'string', False),
        ('lead_time_days_at_comparison', 'number', True), ('validity_at_comparison', 'string', True),
        ('payment_terms_snapshot', 'string', True), ('is_lowest_price', 'boolean', False),
        ('selected_quotation_id', 'string', True), ('is_selected', 'boolean', True),
        ('selection_justification', 'string', True), ('selected_was_lowest', 'boolean', True),
    ],
    'report_supplier_advances': [
        ('id', 'string', False), ('reference', 'string', False), ('supplier_name', 'string', False),
        ('transaction_date', 'string', False), ('amount', 'number', False), ('outstanding_amount', 'number', False),
        ('currency_code', 'string', False), ('payment_method', 'string', False), ('status', 'string', False),
        ('purchase_order_reference', 'string', True), ('treasury_confirmation_reference', 'string', True),
        ('treasury_confirmed_at', 'string', True), ('confirmed_applications', 'number', False),
        ('applied_amount', 'number', False),
    ],
    'report_supplier_procurement': [
        ('supplier_id', 'string', False), ('reference', 'string', False), ('legal_name', 'string', False),
        ('status', 'string', False), ('verification_status', 'string', False),
        ('currency_code', 'string', True),
        ('purchase_order_count', 'number', False), ('ordered_value', 'number', False),
        ('receipt_count', 'number', False), ('advance_count', 'number', False),
        ('last_order_date', 'string', True),
    ],
    'report_procurement_expenditure': [
        ('period_month', 'string', False), ('currency_code', 'string', False), ('supplier_id', 'string', False),
        ('supplier_name', 'string', False), ('department_id', 'string', True), ('department_name', 'string', True),
        ('product_id', 'string', False), ('product_name', 'string', False), ('ordered_value', 'number', False),
        ('ordered_quantity', 'number', False),
    ],
    'report_approval_turnaround': [
        ('entity_type', 'string', False), ('entity_reference', 'string', True), ('entity_id', 'string', False),
        ('submitted_at', 'string', True), ('decided_at', 'string', True), ('latest_decision', 'string', True),
        ('turnaround_hours', 'number', True),
    ],
    'report_purchase_order_amendments': [
        ('id', 'string', False), ('reference', 'string', False), ('purchase_order_id', 'string', False),
        ('purchase_order_reference', 'string', False), ('supplier_name', 'string', False),
        ('status', 'string', False), ('reason', 'string', False), ('base_version', 'number', False),
        ('resulting_version', 'number', True), ('previous_total', 'number', True), ('new_total', 'number', True),
        ('total_change', 'number', True), ('currency_code', 'string', False),
        ('requested_at', 'string', False), ('approved_at', 'string', True), ('applied_at', 'string', True),
        ('requested_by_name', 'string', True), ('change_count', 'number', False),
    ],
    'report_requisition_traceability': [
        ('requisition_id', 'string', False), ('requisition_reference', 'string', False),
        ('requisition_status', 'string', False), ('line_number', 'number', False),
        ('requisition_item_id', 'string', False), ('product_id', 'string', False),
        ('product_name', 'string', True), ('requested_quantity', 'number', False), ('unit_id', 'string', False),
        ('unit_code', 'string', True), ('purchase_order_id', 'string', True),
        ('purchase_order_reference', 'string', True), ('purchase_order_status', 'string', True),
        ('allocated_quantity', 'number', True), ('unallocated_quantity', 'number', True),
    ],
    'report_supplier_advance_applications': [
        ('id', 'string', False), ('advance_id', 'string', False), ('advance_reference', 'string', False),
        ('supplier_name', 'string', False), ('currency_code', 'string', False), ('target_type', 'string', False),
        ('target_reference', 'string', False), ('applied_amount', 'number', False),
        ('confirmation_status', 'string', False), ('applied_at', 'string', False),
        ('confirmed_at', 'string', True), ('advance_amount', 'number', False),
        ('advance_outstanding', 'number', False), ('reduces_balance', 'boolean', False),
    ],
    'report_supplier_balance_position': [
        ('supplier_id', 'string', False), ('reference', 'string', False), ('legal_name', 'string', False),
        ('supplier_status', 'string', False), ('currency_code', 'string', False),
        ('ordered_amount', 'number', False), ('received_value', 'number', False),
        ('invoiced_amount', 'number', False), ('paid_amount', 'number', False),
        ('advance_balance', 'number', False), ('confirmed_payable', 'number', True),
        ('unreconciled_difference', 'number', True), ('payable_is_basis_known', 'boolean', False),
    ],
    'report_approval_decisions': [
        ('id', 'string', False), ('entity_type', 'string', False), ('entity_id', 'string', False),
        ('entity_reference', 'string', False), ('stage', 'string', True), ('decision', 'string', False),
        ('amount_at_decision', 'number', True), ('currency_code', 'string', True),
        ('authority_id', 'string', True), ('sod_rule_id', 'string', True), ('comment', 'string', True),
        ('created_at', 'string', False), ('decided_by_name', 'string', True),
        ('authority_transaction_type', 'string', True), ('authority_maximum', 'number', True),
    ],
    'report_goods_receipt_inspections': [
        ('id', 'string', False), ('goods_receipt_id', 'string', False),
        ('goods_receipt_reference', 'string', False), ('receipt_date', 'string', False),
        ('purchase_order_id', 'string', False), ('purchase_order_reference', 'string', False),
        ('goods_receipt_item_id', 'string', True), ('line_number', 'number', True),
        ('inspection_type', 'string', False), ('result', 'string', False),
        ('quantity_inspected', 'number', True), ('findings', 'string', True),
        ('inspected_at', 'string', False), ('inspected_by_name', 'string', True),
    ],
    'report_procurement_documents': [
        ('id', 'string', False), ('entity_type', 'string', False), ('entity_id', 'string', False),
        ('entity_reference', 'string', False), ('document_type', 'string', False), ('title', 'string', False),
        ('file_name', 'string', False), ('mime_type', 'string', False), ('file_size_bytes', 'number', False),
        ('is_confidential', 'boolean', False), ('uploaded_at', 'string', False),
        ('uploaded_by_name', 'string', True), ('storage_state', 'string', False),
    ],
    'report_purchase_order_versions': [
        ('id', 'string', False), ('purchase_order_id', 'string', False),
        ('purchase_order_reference', 'string', False), ('version', 'number', False),
        ('reference', 'string', False), ('status_at_snapshot', 'string', False),
        ('total_amount', 'number', False), ('currency_code', 'string', False), ('reason', 'string', True),
        ('created_at', 'string', False), ('created_by_name', 'string', True),
    ],
    'report_procurement_status_history': [
        ('id', 'string', False), ('entity_type', 'string', False), ('entity_id', 'string', False),
        ('entity_reference', 'string', False), ('from_status', 'string', True), ('to_status', 'string', False),
        ('reason', 'string', True), ('created_at', 'string', False), ('actor_name', 'string', True),
    ],
    'procurement_data_quality': [
        ('entity_type', 'string', False), ('indicator', 'string', False), ('description', 'string', False),
        ('severity', 'string', False), ('record_count', 'number', False),
    ],

    # ---- Phase 4: inventory --------------------------------------------------
    'inventory_lot_balances': [
        ('lot_id', 'string', False), ('lot_reference', 'string', False), ('product_id', 'string', False),
        ('product_code', 'string', False), ('product_name', 'string', False), ('unit_id', 'string', False),
        ('unit_code', 'string', False), ('warehouse_id', 'string', False), ('warehouse_name', 'string', False),
        ('location_id', 'string', True), ('lot_status', 'string', False), ('source_type', 'string', False),
        ('source_reference', 'string', True), ('supplier_id', 'string', True),
        ('goods_receipt_id', 'string', True), ('production_batch_id', 'string', True),
        ('received_date', 'string', False), ('expiry_date', 'string', True),
        ('on_hand_quantity', 'number', False), ('total_in_quantity', 'number', False),
        ('total_out_quantity', 'number', False), ('movement_count', 'number', False),
        ('last_movement_at', 'string', True), ('recorded_value', 'number', False),
    ],
    'inventory_product_balances': [
        ('product_id', 'string', False), ('product_code', 'string', False), ('product_name', 'string', False),
        ('unit_id', 'string', False), ('unit_code', 'string', False), ('warehouse_count', 'number', False),
        ('lot_count', 'number', False), ('on_hand_quantity', 'number', False),
        ('in_quantity', 'number', False), ('out_quantity', 'number', False),
    ],
    'inventory_ledger_integrity': [
        ('movements_without_lot', 'number', False), ('movements_with_bad_direction', 'number', False),
        ('movements_with_non_positive_quantity', 'number', False),
        ('reversals_in_wrong_direction', 'number', False), ('lots_with_negative_balance', 'number', False),
        ('lots_with_duplicate_movement_ids', 'number', False),
    ],
    'inventory_availability': [
        ('lot_id', 'string', False), ('lot_reference', 'string', False), ('product_id', 'string', False),
        ('product_code', 'string', False), ('product_name', 'string', False), ('unit_id', 'string', False),
        ('unit_code', 'string', False), ('warehouse_id', 'string', False), ('warehouse_name', 'string', False),
        ('location_id', 'string', True), ('lot_status', 'string', False), ('supplier_id', 'string', True),
        ('goods_receipt_id', 'string', True), ('production_batch_id', 'string', True),
        ('expiry_date', 'string', True), ('on_hand_quantity', 'number', False),
        ('restricted_quantity', 'number', False), ('reserved_quantity', 'number', False),
        ('available_quantity', 'number', False), ('active_restriction_count', 'number', False),
        ('active_reservation_count', 'number', False), ('received_date', 'string', False),
        ('manufacture_date', 'string', True), ('grade', 'string', True),
    ],
    'inventory_in_transit': [
        ('transfer_id', 'string', False), ('reference', 'string', False), ('status', 'string', False),
        ('dispatched_at', 'string', True), ('from_warehouse_id', 'string', False),
        ('from_warehouse_name', 'string', False), ('to_warehouse_id', 'string', False),
        ('to_warehouse_name', 'string', False), ('product_id', 'string', False),
        ('product_code', 'string', False), ('product_name', 'string', False), ('unit_id', 'string', False),
        ('unit_code', 'string', False), ('dispatched_quantity', 'number', False),
        ('received_quantity', 'number', False), ('in_transit_quantity', 'number', False),
    ],
    'inventory_stock_summary': [
        ('product_id', 'string', False), ('product_code', 'string', False), ('product_name', 'string', False),
        ('unit_id', 'string', False), ('unit_code', 'string', False), ('warehouse_id', 'string', False),
        ('warehouse_name', 'string', False), ('lot_count', 'number', False),
        ('on_hand_quantity', 'number', False), ('restricted_quantity', 'number', False),
        ('reserved_quantity', 'number', False), ('available_quantity', 'number', False),
        ('earliest_expiry_date', 'string', True),
    ],
    'inventory_movement_register': [
        ('id', 'string', False), ('movement_reference', 'string', False), ('movement_date', 'string', False),
        ('posted_at', 'string', False), ('movement_type', 'string', False), ('direction', 'string', False),
        ('quantity', 'number', False), ('product_id', 'string', False), ('product_code', 'string', False),
        ('product_name', 'string', False), ('unit_id', 'string', False), ('unit_code', 'string', False),
        ('warehouse_id', 'string', False), ('warehouse_name', 'string', False), ('lot_id', 'string', False),
        ('lot_reference', 'string', False), ('source_module', 'string', False), ('source_type', 'string', False),
        ('source_id', 'string', True), ('source_reference', 'string', True),
        ('reverses_movement_id', 'string', True), ('reason', 'string', True), ('posted_by', 'string', True),
        ('posted_by_name', 'string', True),
    ],
    'inventory_expiring_lots': [
        ('lot_id', 'string', False), ('lot_reference', 'string', False), ('product_id', 'string', False),
        ('product_code', 'string', False), ('product_name', 'string', False),
        ('warehouse_id', 'string', False), ('warehouse_name', 'string', False),
        ('on_hand_quantity', 'number', False), ('available_quantity', 'number', False),
        ('expiry_date', 'string', False), ('days_to_expiry', 'number', False), ('expiry_band', 'string', False),
    ],
    'inventory_restriction_register': [
        ('id', 'string', False), ('restriction_reference', 'string', False), ('lot_id', 'string', False),
        ('lot_reference', 'string', False), ('product_id', 'string', False), ('product_code', 'string', False),
        ('product_name', 'string', False), ('quantity', 'number', False), ('released_quantity', 'number', False),
        ('outstanding_quantity', 'number', False), ('restriction_type', 'string', False),
        ('reason_code', 'string', False), ('reason', 'string', True), ('status', 'string', False),
        ('source_module', 'string', False), ('source_type', 'string', False), ('source_id', 'string', True),
        ('expires_at', 'string', True), ('created_at', 'string', False), ('released_at', 'string', True),
    ],
    'inventory_reservation_register': [
        ('id', 'string', False), ('reference', 'string', False), ('lot_id', 'string', False),
        ('lot_reference', 'string', False), ('product_id', 'string', False), ('product_code', 'string', False),
        ('product_name', 'string', False), ('warehouse_id', 'string', False), ('warehouse_name', 'string', False),
        ('quantity', 'number', False), ('released_quantity', 'number', False),
        ('outstanding_quantity', 'number', False), ('status', 'string', False),
        ('reserved_for_module', 'string', False), ('reserved_for_type', 'string', False),
        ('reserved_for_id', 'string', True), ('reserved_for_reference', 'string', True),
        ('expires_at', 'string', True), ('created_at', 'string', False),
    ],
    # ---- Phase 4: production -------------------------------------------------
    'production_batch_summary': [
        ('id', 'string', False), ('reference', 'string', False), ('status', 'string', False),
        ('batch_date', 'string', False), ('plan_id', 'string', True), ('plan_reference', 'string', True),
        ('product_id', 'string', False), ('product_code', 'string', False), ('product_name', 'string', False),
        ('unit_id', 'string', False), ('unit_code', 'string', False), ('warehouse_id', 'string', False),
        ('warehouse_name', 'string', False), ('planned_quantity', 'number', False),
        ('issued_quantity', 'number', False), ('output_quantity', 'number', False),
        ('waste_quantity', 'number', False), ('recorded_yield_percent', 'number', True),
        ('recorded_yield_basis', 'string', True), ('within_declared_band', 'boolean', True),
        ('started_at', 'string', True), ('completed_at', 'string', True), ('closed_at', 'string', True),
    ],
    'production_plan_progress': [
        ('id', 'string', False), ('reference', 'string', False), ('status', 'string', False),
        ('planned_date', 'string', False), ('product_id', 'string', False), ('product_code', 'string', False),
        ('product_name', 'string', False), ('unit_id', 'string', False), ('unit_code', 'string', False),
        ('planned_quantity', 'number', False), ('produced_quantity', 'number', False),
        ('batch_count', 'number', False), ('outstanding_quantity', 'number', False),
        ('progress_percent', 'number', True), ('open_batch_count', 'number', False),
    ],
    'production_material_consumption': [
        ('batch_id', 'string', False), ('batch_reference', 'string', False), ('batch_date', 'string', False),
        ('product_id', 'string', False), ('product_code', 'string', False), ('product_name', 'string', False),
        ('unit_id', 'string', False), ('unit_code', 'string', False), ('consumed_quantity', 'number', False),
        ('issue_count', 'number', False), ('lot_count', 'number', False),
    ],
    'production_yield_summary': [
        ('product_id', 'string', False), ('product_code', 'string', False), ('product_name', 'string', False),
        ('period_month', 'string', False), ('closed_batch_count', 'number', False),
        ('total_issued_quantity', 'number', False), ('total_output_quantity', 'number', False),
        ('total_waste_quantity', 'number', False), ('average_recorded_yield_percent', 'number', True),
        ('lowest_recorded_yield_percent', 'number', True), ('highest_recorded_yield_percent', 'number', True),
        ('batches_outside_declared_band', 'number', False),
        ('batches_without_comparable_yield', 'number', False),
    ],
}

RPC_FUNCTIONS = {
    'current_profile_id': ('Record<PropertyKey, never>', 'string | null'),
    'current_employee_id': ('Record<PropertyKey, never>', 'string | null'),
    'is_active_profile': ('Record<PropertyKey, never>', 'boolean'),
    'has_permission': ('{ permission_code: string }', 'boolean'),
    'has_scoped_permission': ('{ permission_code: string; target_department_id: string | null }', 'boolean'),
    'has_role': ('{ role_code: string }', 'boolean'),
    'current_user_permissions': ('Record<PropertyKey, never>', 'string[]'),
    'next_employee_number': ('Record<PropertyKey, never>', 'string'),
    'post_goods_receipt': (
        '{ p_receipt_id: string; p_idempotency_key: string; p_allow_excess?: boolean }',
        '{ posting_reference: string; already_posted: boolean; outbox_event_id: string | null }[]',
    ),
    'apply_purchase_order_amendment': (
        '{ p_amendment_id: string; p_confirm_received_impact?: boolean }',
        '{ purchase_order_id: string; version: number; total_amount: number; previous_total: number }[]',
    ),
    # 0054: the single execution path for approvals, plus the two helpers the interface uses to be
    # honest about what the signed-in user may do.
    'procurement_decide': (
        '{ p_entity_type: string; p_entity_id: string; p_decision: string; p_comment?: string | null }',
        '{ entity_type: string; entity_id: string; previous_status: string; new_status: string;'
        ' authority_id: string | null; sod_rule_id: string | null }[]',
    ),
    'procurement_authority_covers': (
        '{ p_module: string; p_transaction_type: string; p_amount: number; p_currency: string }',
        'boolean',
    ),
    # 0056/0057: atomic create and draft-edit functions. Args are declared so the services get
    # compile-time protection against a renamed parameter.
    # ---- Phase 4: inventory ------------------------------------------------
    'inventory_apply_restriction': (
        '{ p_lot_id: string; p_quantity: number; p_reason_code: string; p_source_module: string;'
        ' p_source_type: string; p_source_id?: string | null; p_idempotency_key?: string | null;'
        ' p_reason?: string | null; p_restriction_type?: string; p_expires_at?: string | null }',
        '{ id: string; restriction_reference: string; status: string; quantity: number;'
        ' released_quantity: number }[]',
    ),
    'inventory_release_restriction': (
        '{ p_restriction_id: string; p_quantity: number; p_reason: string }',
        '{ id: string; status: string; quantity: number; released_quantity: number }[]',
    ),
    'inventory_consume_goods_receipt': (
        '{ p_goods_receipt_id: string }',
        '{ receipt_id: string; lots_created: number; consumed: boolean; message: string }[]',
    ),
    'inventory_consume_pending_receipts': (
        '{ p_limit?: number }',
        'number',
    ),
    'inventory_dispatch_transfer': (
        '{ p_transfer_id: string }',
        '{ transfer_id: string; reference: string; status: string; dispatched_lines: number }[]',
    ),
    'inventory_receive_transfer': (
        '{ p_transfer_id: string }',
        '{ transfer_id: string; reference: string; status: string; received_lines: number }[]',
    ),
    'inventory_reserve_stock': (
        '{ p_lot_id: string; p_quantity: number; p_reserved_for_module: string;'
        ' p_reserved_for_type: string; p_reserved_for_id?: string | null;'
        ' p_reserved_for_reference?: string | null; p_idempotency_key?: string | null;'
        ' p_notes?: string | null; p_expires_at?: string | null }',
        '{ id: string; reference: string; status: string; quantity: number; released_quantity: number }[]',
    ),
    'inventory_release_reservation': (
        '{ p_reservation_id: string; p_quantity: number; p_reason: string }',
        '{ id: string; reference: string; status: string; quantity: number; released_quantity: number }[]',
    ),
    'inventory_expire_reservations': ('Record<PropertyKey, never>', 'number'),
    'inventory_start_stock_count': (
        '{ p_warehouse_id: string; p_location_id?: string | null; p_count_date?: string | null;'
        ' p_notes?: string | null }',
        '{ id: string; reference: string; status: string }[]',
    ),
    'inventory_record_count_line': (
        '{ p_count_line_id: string; p_counted_quantity: number; p_notes?: string | null }',
        '{ id: string; counted_quantity: number | null; variance_quantity: number | null }[]',
    ),
    'inventory_post_stock_count': (
        '{ p_count_id: string }',
        '{ id: string; reference: string; status: string; total_gain_quantity: number;'
        ' total_loss_quantity: number }[]',
    ),
    'inventory_post_adjustment': (
        '{ p_adjustment_id: string }',
        '{ id: string; reference: string; status: string }[]',
    ),
    # ---- Phase 4: production -----------------------------------------------
    'production_plan_apply_declared_inputs': ('{ p_plan_id: string }', 'number'),
    'production_plan_reserve_material': (
        '{ p_plan_id: string; p_lot_id: string; p_quantity: number; p_notes?: string | null }',
        '{ id: string; reference: string; status: string; quantity: number; released_quantity: number }[]',
    ),
    'production_start_batch': (
        '{ p_plan_id?: string | null; p_product_id?: string | null; p_planned_quantity?: number | null;'
        ' p_unit_id?: string | null; p_warehouse_id?: string | null; p_batch_date?: string | null;'
        ' p_supervisor_employee_id?: string | null; p_notes?: string | null }',
        '{ id: string; reference: string; status: string }[]',
    ),
    'production_issue_material': (
        '{ p_batch_id: string; p_lot_id: string; p_quantity: number; p_notes?: string | null }',
        '{ id: string; line_number: number; lot_id: string; quantity: number; movement_id: string }[]',
    ),
    'production_record_output': (
        '{ p_batch_id: string; p_quantity: number; p_output_type?: string; p_product_id?: string | null;'
        ' p_unit_id?: string | null; p_location_id?: string | null; p_manufacture_date?: string | null;'
        ' p_expiry_date?: string | null; p_grade?: string | null; p_notes?: string | null }',
        '{ id: string; lot_id: string; quantity: number; output_type: string; restriction_id: string | null }[]',
    ),
    'production_close_batch': (
        '{ p_batch_id: string; p_reason?: string | null; p_output_location_id?: string | null }',
        '{ id: string; reference: string; status: string; recorded_yield_percent: number | null;'
        ' within_declared_band: boolean | null }[]',
    ),
    'production_log_batch': (
        '{ p_batch_id: string; p_body: string; p_log_type?: string; p_shift?: string | null;'
        ' p_stage_id?: string | null }',
        '{ id: string; batch_id: string; log_date: string; body: string }[]',
    ),
    'procurement_create_requisition': (
        '{ p_department_id: string; p_requesting_employee_id: string; p_requisition_date: string;'
        ' p_required_delivery_date: string; p_purpose: string; p_priority: string; p_currency_code: string;'
        ' p_items: Json; p_preferred_supplier_id?: string | null; p_suggested_warehouse_id?: string | null;'
        ' p_justification?: string | null; p_notes?: string | null }',
        '{ id: string; reference: string }[]',
    ),
    'procurement_update_requisition': (
        '{ p_id: string; p_required_delivery_date: string; p_purpose: string; p_priority: string;'
        ' p_currency_code: string; p_items: Json; p_preferred_supplier_id?: string | null;'
        ' p_suggested_warehouse_id?: string | null; p_justification?: string | null; p_notes?: string | null }',
        '{ id: string; reference: string }[]',
    ),
    'procurement_create_quotation': (
        '{ p_supplier_id: string; p_quotation_date: string; p_currency_code: string; p_items: Json;'
        ' p_requisition_id?: string | null; p_quotation_request_id?: string | null;'
        ' p_supplier_quotation_reference?: string | null; p_valid_until?: string | null;'
        ' p_payment_terms_id?: string | null; p_delivery_terms_id?: string | null;'
        ' p_delivery_lead_time_days?: number | null; p_proposed_delivery_date?: string | null;'
        ' p_discount_amount?: number | null; p_delivery_charges?: number | null;'
        ' p_other_charges?: number | null; p_charge_notes?: string | null; p_remarks?: string | null }',
        '{ id: string; reference: string }[]',
    ),
    'procurement_update_quotation': (
        '{ p_id: string; p_valid_until: string | null; p_items: Json;'
        ' p_delivery_lead_time_days?: number | null; p_proposed_delivery_date?: string | null;'
        ' p_discount_amount?: number | null; p_delivery_charges?: number | null;'
        ' p_other_charges?: number | null; p_charge_notes?: string | null; p_remarks?: string | null }',
        '{ id: string; reference: string }[]',
    ),
    'procurement_create_purchase_order': (
        '{ p_supplier_id: string; p_order_date: string; p_currency_code: string; p_items: Json;'
        ' p_selected_quotation_id?: string | null; p_selection_id?: string | null;'
        ' p_expected_delivery_date?: string | null; p_exchange_rate?: number | null;'
        ' p_exchange_rate_type?: string | null; p_base_currency_code?: string | null;'
        ' p_payment_terms_id?: string | null; p_delivery_terms_id?: string | null;'
        ' p_delivery_warehouse_id?: string | null; p_delivery_location_id?: string | null;'
        ' p_delivery_address?: string | null; p_procurement_officer_employee_id?: string | null;'
        ' p_department_id?: string | null; p_requisition_ids?: string[] | null;'
        ' p_internal_remarks?: string | null; p_supplier_instructions?: string | null }',
        '{ id: string; reference: string }[]',
    ),
    'procurement_update_draft_purchase_order': (
        '{ p_id: string; p_expected_delivery_date: string | null; p_currency_code: string; p_items: Json;'
        ' p_exchange_rate?: number | null; p_exchange_rate_type?: string | null;'
        ' p_base_currency_code?: string | null; p_payment_terms_id?: string | null;'
        ' p_delivery_terms_id?: string | null; p_delivery_warehouse_id?: string | null;'
        ' p_delivery_location_id?: string | null; p_delivery_address?: string | null;'
        ' p_procurement_officer_employee_id?: string | null; p_department_id?: string | null;'
        ' p_internal_remarks?: string | null; p_supplier_instructions?: string | null }',
        '{ id: string; reference: string }[]',
    ),
    'procurement_create_goods_receipt': (
        '{ p_purchase_order_id: string; p_warehouse_id: string; p_receipt_date: string; p_items: Json;'
        ' p_supplier_delivery_note_number?: string | null; p_delivery_reference?: string | null;'
        ' p_location_id?: string | null; p_receiving_employee_id?: string | null;'
        ' p_vehicle_reference?: string | null; p_transporter_name?: string | null;'
        ' p_observations?: string | null }',
        '{ id: string; reference: string }[]',
    ),
    'procurement_create_amendment': (
        '{ p_purchase_order_id: string; p_reason: string; p_items: Json;'
        ' p_requested_employee_id?: string | null }',
        '{ id: string; reference: string; base_version: number }[]',
    ),
    'procurement_notify_approvers': (
        '{ p_permission: string; p_title: string; p_body: string; p_entity_type: string;'
        ' p_entity_id: string; p_href: string }',
        'number',
    ),
}

# Row aliases the application imports. `camelCase` aliases are the ones used across the codebase.
ALIASES = [
    ('Department', 'departments'), ('Employee', 'employees'), ('EmployeePosition', 'employee_positions'),
    ('EmployeeHistoryRow', 'employee_department_history'), ('EmergencyContact', 'employee_emergency_contacts'),
    ('Profile', 'profiles'), ('AccountActivity', 'account_activity'), ('Role', 'roles'),
    ('Permission', 'permissions'), ('RolePermission', 'role_permissions'), ('UserRole', 'user_roles'),
    ('ApprovalAuthority', 'approval_authorities'), ('ApprovalLimit', 'approval_limits'),
    ('ApprovalDelegation', 'approval_delegations'), ('SodRule', 'segregation_of_duties_rules'),
    ('SodOverride', 'sod_overrides'), ('AccessReviewRecord', 'access_review_records'),
    ('AuditLog', 'audit_logs'), ('SystemSetting', 'system_settings'),
    ('SupplierCategory', 'supplier_categories'), ('Supplier', 'suppliers'),
    ('SupplierContact', 'supplier_contacts'), ('SupplierAddress', 'supplier_addresses'),
    ('SupplierBankAccount', 'supplier_bank_accounts'), ('SupplierDocument', 'supplier_documents'),
    ('CustomerCategory', 'customer_categories'), ('Customer', 'customers'),
    ('CustomerContact', 'customer_contacts'), ('CustomerAddress', 'customer_addresses'),
    ('CustomerCreditProfile', 'customer_credit_profiles'), ('CustomerDocument', 'customer_documents'),
    ('ProductCategory', 'product_categories'), ('Product', 'products'),
    ('ProductVariant', 'product_variants'), ('ProductAttributeDefinition', 'product_attribute_definitions'),
    ('ProductAttributeValue', 'product_attribute_values'), ('ProductSpecification', 'product_specifications'),
    ('ProductPackaging', 'product_packaging'), ('UnitOfMeasure', 'units_of_measure'),
    ('UnitConversion', 'unit_conversions'), ('Site', 'sites'), ('Warehouse', 'warehouses'),
    ('WarehouseLocation', 'warehouse_locations'), ('Currency', 'currencies'),
    ('ExchangeRate', 'exchange_rates'), ('PaymentTerm', 'payment_terms'), ('DeliveryTerm', 'delivery_terms'),
    ('TaxCategory', 'tax_categories'), ('MasterDataChangeHistoryRow', 'master_data_change_history'),
    ('MasterDataDuplicateCandidate', 'master_data_duplicate_candidates'),
    ('MasterDataImportJob', 'master_data_import_jobs'), ('MasterDataImportRow', 'master_data_import_rows'),
    ('LegacyRecordReference', 'legacy_record_references'), ('MasterDataEntity', 'master_data_entities'),
    ('MasterDataStatusTransition', 'master_data_status_transitions'),
    ('PurchaseRequisition', 'purchase_requisitions'), ('PurchaseRequisitionItem', 'purchase_requisition_items'),
    ('PurchaseRequisitionAllocation', 'purchase_requisition_allocations'),
    ('SupplierQuotationRequest', 'supplier_quotation_requests'),
    ('SupplierQuotation', 'supplier_quotations'), ('SupplierQuotationItem', 'supplier_quotation_items'),
    ('SupplierQuotationComparison', 'supplier_quotation_comparisons'),
    ('SupplierQuotationComparisonQuote', 'supplier_quotation_comparison_quotes'),
    ('SupplierQuotationSelection', 'supplier_quotation_selections'),
    ('PurchaseOrder', 'purchase_orders'), ('PurchaseOrderItem', 'purchase_order_items'),
    ('PurchaseOrderVersion', 'purchase_order_versions'), ('PurchaseOrderAmendment', 'purchase_order_amendments'),
    ('PurchaseOrderAmendmentItem', 'purchase_order_amendment_items'),
    ('GoodsReceipt', 'goods_receipts'), ('GoodsReceiptItem', 'goods_receipt_items'),
    ('GoodsReceiptInspection', 'goods_receipt_inspections'), ('GoodsReceiptPosting', 'goods_receipt_postings'),
    ('SupplierAdvance', 'supplier_advances'),
    ('SupplierAdvancePaymentDetail', 'supplier_advance_payment_details'),
    ('SupplierAdvanceApplication', 'supplier_advance_applications'),
    ('SupplierTransactionReference', 'supplier_transaction_references'),
    ('SupplierReconciliation', 'supplier_reconciliations'),
    ('SupplierReconciliationItem', 'supplier_reconciliation_items'),
    ('ProcurementDocument', 'procurement_documents'), ('ProcurementComment', 'procurement_comments'),
    ('ProcurementApproval', 'procurement_approvals'),
    ('ProcurementStatusHistoryRow', 'procurement_status_history'),
    ('ProcurementIntegrationOutboxEvent', 'procurement_integration_outbox'),
    ('ProcurementSetting', 'procurement_settings'), ('ProcurementNumbering', 'procurement_numbering'),
    ('ProcurementStatusTransition', 'procurement_status_transitions'),
    ('ProcurementSupplierException', 'procurement_supplier_exceptions'),
    ('ProcurementLegacyImport', 'procurement_legacy_imports'),
    ('ProcurementLegacyImportRow', 'procurement_legacy_import_rows'),
    ('NotificationRow', 'notifications'),
]


def map_type(sql_type: str) -> str:
    is_array = sql_type.endswith('[]')
    base = sql_type[:-2] if is_array else sql_type
    for pattern, ts in TYPE_MAP:
        if re.match(pattern, base):
            return f'{ts}[]' if is_array else ts
    raise SystemExit(f'Unmapped SQL type: {sql_type}')


def parse_columns(body: str):
    columns = []
    for raw_line in body.split('\n'):
        line = raw_line.strip()
        if not line or line.lower().startswith(SKIP_PREFIXES):
            continue
        name_match = re.match(r'^([a-z_][a-z0-9_]*)\s+(.+)$', line)
        if not name_match:
            continue
        name, rest = name_match.group(1), name_match.group(2)
        type_match = re.match(r'^([a-z0-9]+(?:\([^)]*\))?(?:\s*\[\])?)', rest)
        if not type_match:
            continue
        ts_type = map_type(type_match.group(1).replace(' ', '').lower())
        lowered = f' {rest.lower()}'
        nullable = ' not null' not in lowered and 'default' not in lowered and 'primary key' not in lowered
        columns.append([name, ts_type, nullable])
    return columns


def main() -> None:
    tables: 'dict[str, list[list]]' = {}

    for path in sorted(glob.glob('supabase/migrations/*.sql')):
        with open(path, encoding='utf8') as handle:
            sql = handle.read()

        for match in re.finditer(r'create table (?:if not exists )?public\.(\w+)\s*\((.*?)\n\);', sql, re.S):
            table, body = match.group(1), match.group(2)
            columns = parse_columns(body)
            if columns:
                tables[table] = columns

        # One ALTER statement may add many columns; parse the statement, then each `add column`.
        for statement in re.finditer(r'alter table public\.(\w+)(.*?);', sql, re.S):
            table, body = statement.group(1), statement.group(2)
            if table not in tables:
                continue
            for column_match in re.finditer(
                r'add column (?:if not exists )?(\w+)\s+([a-z0-9]+(?:\([^)]*\))?)', body
            ):
                column, raw_type = column_match.group(1), column_match.group(2)
                if any(existing[0] == column for existing in tables[table]):
                    continue
                # A column added with `default` in the same statement is never null in a read row.
                tail = body[column_match.end():][:200]
                nullable = 'not null' not in tail.split(',')[0] and 'default' not in tail.split(',')[0]
                tables[table].append([column, map_type(raw_type.lower()), nullable])

    for (table, column), override in COLUMN_TYPE_OVERRIDES.items():
        if table in tables:
            for entry in tables[table]:
                if entry[0] == column:
                    entry[1] = override

    table_blocks = []
    for table, columns in tables.items():
        body = '\n'.join(
            f'        {name}: {ts}{" | null" if nullable else ""};' for name, ts, nullable in columns
        )
        table_blocks.append(f'      {table}: TableDef<{{\n{body}\n      }}>;')

    view_blocks = []
    for view, columns in VIEW_ROWS.items():
        body = '\n'.join(
            f'        {name}: {ts}{" | null" if nullable else ""};' for name, ts, nullable in columns
        )
        view_blocks.append(f'      {view}: ViewDef<{{\n{body}\n      }}>;')

    function_blocks = []
    for name, (args, returns) in RPC_FUNCTIONS.items():
        function_blocks.append(f'      {name}: {{ Args: {args}; Returns: {returns} }};')

    alias_lines = [
        f'export type {alias} = RowOf<"{table}">;'
        for alias, table in ALIASES
        if table in tables
    ]

    status_aliases = []
    for alias, table, column in [
        ('SupplierStatus', 'suppliers', 'status'),
        ('CustomerStatus', 'customers', 'status'),
        ('ProductStatus', 'products', 'status'),
        ('PurchaseRequisitionStatus', 'purchase_requisitions', 'status'),
        ('SupplierQuotationStatus', 'supplier_quotations', 'status'),
        ('PurchaseOrderStatus', 'purchase_orders', 'status'),
        ('GoodsReceiptStatus', 'goods_receipts', 'status'),
        ('SupplierAdvanceStatus', 'supplier_advances', 'status'),
        ('PurchaseOrderAmendmentStatus', 'purchase_order_amendments', 'status'),
    ]:
        if table in tables:
            status_aliases.append(f'export type {alias} = {alias.replace("Status", "")}["{column}"];')

    content = f'''/**
 * Database types for the Pluck Agro ERP schema.
 *
 * GENERATED FILE — do not edit by hand.
 * Source: supabase/migrations/*.sql
 * Regenerate: python3 scripts/generate-database-types.py
 *
 * No hosted Supabase project is linked yet, so `supabase gen types` cannot run; this generator
 * plays that role. Column shapes come from the migrations, the RPC signatures from the
 * transactional functions, and the union-typed status columns from an explicit override table
 * (SQL says `text`; the application knows the vocabulary is closed).
 *
 * `Insert`/`Update` are partial views of `Row`: every mutation is validated by Zod at the service
 * boundary before it reaches the database, and the database enforces the real constraints
 * (NOT NULL, checks, triggers).
 */

export type Json = string | number | boolean | null | {{ [key: string]: Json | undefined }} | Json[];

export type EmploymentStatus = "active" | "on_leave" | "suspended" | "resigned" | "terminated" | "retired" | "probation";

export type AccountStatus = "invited" | "pending_setup" | "active" | "suspended" | "deactivated" | "locked";

export type RoleCategory = "system" | "executive" | "administration" | "operations" | "commercial" | "finance" | "assurance" | "custom";

export type PermissionScopeName = "GLOBAL" | "DEPARTMENT" | "OWN_RECORDS" | "ASSIGNED_RECORDS" | "LOCATION" | "WAREHOUSE" | "ENTITY";

export type DelegationStatus = "pending_approval" | "approved" | "rejected" | "revoked" | "expired";

export type SodEnforcement = "BLOCK" | "WARN" | "REQUIRE_OVERRIDE";

export type ReviewStatus = "pending" | "in_review" | "completed" | "flagged";

export type ReviewDecision = "retain" | "amend" | "revoke";

export type AuditCategory =
  | "authentication"
  | "employee_management"
  | "account_management"
  | "authorization"
  | "governance"
  | "system_administration"
  | "master_data"
  | "procurement"
  | "inventory"
  | "production"
  | "general";

export type AuditSeverity = "info" | "notice" | "warning" | "critical";

export type ImportJobStatus = "uploaded" | "validated" | "awaiting_confirmation" | "imported" | "failed" | "cancelled";

export type Relationship = {{
  foreignKeyName: string;
  columns: string[];
  isOneToOne: boolean;
  referencedRelation: string;
  referencedColumns: string[];
}};

type TableDef<Row> = {{
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: Relationship[];
}};

type ViewDef<Row> = {{
  Row: Row;
  Relationships: Relationship[];
}};

type Rel = Relationship[];

export interface Database {{
  public: {{
    Tables: {{
{chr(10).join(table_blocks)}
    }};
    Views: {{
{chr(10).join(view_blocks)}
    }};
    Functions: {{
{chr(10).join(function_blocks)}
    }};
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  }};
}}

export type PublicSchema = Database["public"];
export type TableName = keyof PublicSchema["Tables"];
export type ViewName = keyof PublicSchema["Views"];
export type RowOf<T extends TableName> = PublicSchema["Tables"][T]["Row"];
export type ViewRowOf<T extends ViewName> = PublicSchema["Views"][T]["Row"];

{chr(10).join(alias_lines)}

{chr(10).join(status_aliases)}

export type {{ Relationship as Rel, Rel as RelationshipList }};
'''

    with open('types/database.types.ts', 'w', encoding='utf8') as handle:
        handle.write(content)
    print(f'Generated types for {len(tables)} tables and {len(VIEW_ROWS)} views.')


if __name__ == '__main__':
    main()
