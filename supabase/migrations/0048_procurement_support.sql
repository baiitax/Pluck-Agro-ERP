-- 0048 — procurement support: notifications, documents, comments, legacy mapping readiness
--
-- Three things live here that the specification assumed Phase 0/1 already provided but the
-- repository does not contain:
--
--   * notifications — the repository has a /notifications page and no table behind it. A minimal,
--     module-agnostic store is created so procurement events are real records rather than a promise
--     in a report. It is deliberately not procurement-specific: a later system-wide notification
--     module extends this table instead of replacing it.
--   * document metadata — supplier/customer documents already store metadata with no public URL.
--     Procurement follows the same shape. There is no storage bucket in this environment, so the
--     upload path is validated metadata only and the UI says so.
--   * legacy mapping readiness — staging rows and a cross-reference register. Nothing here connects
--     to the legacy database; it is the place where an authorised migration would record its
--     decisions.

-- ---------------------------------------------------------------------------
-- 1. Notifications
-- ---------------------------------------------------------------------------

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_profile_id uuid not null references public.profiles (id) on delete cascade on update cascade,
  module text not null,
  event_type text not null,
  title text not null,
  body text,
  entity_type text,
  entity_id uuid,
  href text,
  severity text not null default 'info',
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_severity_check check (severity in ('info', 'notice', 'warning', 'critical')),
  constraint notifications_title_present check (length(btrim(title)) >= 3),
  constraint notifications_dedupe_unique unique (dedupe_key)
);

create index if not exists notifications_recipient_idx
  on public.notifications (recipient_profile_id, read_at, created_at desc);
create index if not exists notifications_entity_idx on public.notifications (entity_type, entity_id);

comment on table public.notifications is
  'In-app notifications. One row per recipient, permission-checked at read time by RLS. No email or WhatsApp delivery is attempted.';

-- ---------------------------------------------------------------------------
-- 2. Documents (metadata only)
-- ---------------------------------------------------------------------------

insert into public.procurement_settings (key, value_text, description)
values
  ('allowed_document_mime_types',
   'application/pdf,image/jpeg,image/png,image/webp,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
   'Comma-separated list of permitted procurement document content types.'),
  ('max_document_size_mb', '10',
   'Maximum size of a procurement document, in megabytes.')
on conflict (key) do nothing;

create table if not exists public.procurement_documents (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  entity_reference text,
  document_type text not null,
  title text not null,
  file_name text not null,
  mime_type text not null,
  file_size_bytes bigint not null,
  storage_bucket text,
  storage_path text,
  checksum_sha256 text,
  is_confidential boolean not null default false,
  notes text,
  uploaded_by uuid references public.profiles (id) on delete set null on update cascade,
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint procurement_documents_entity_check
    check (entity_type in ('purchase_requisition', 'supplier_quotation', 'purchase_order',
                           'purchase_order_amendment', 'goods_receipt', 'supplier_advance',
                           'supplier_reconciliation')),
  constraint procurement_documents_type_check
    check (document_type in ('quotation', 'purchase_order', 'delivery_note', 'goods_receipt',
                             'product_photo', 'inspection', 'payment_evidence', 'correspondence', 'other')),
  constraint procurement_documents_title_present check (length(btrim(title)) >= 2),
  constraint procurement_documents_size_positive check (file_size_bytes > 0),
  -- Same rule as Phase 2 documents: a storage path is a private object key, never a public URL.
  constraint procurement_documents_no_public_url
    check (storage_path is null or storage_path !~* '^https?://')
);

create index if not exists procurement_documents_entity_idx
  on public.procurement_documents (entity_type, entity_id);
create index if not exists procurement_documents_uploaded_idx
  on public.procurement_documents (uploaded_at desc);

comment on table public.procurement_documents is
  'Document metadata for procurement records. Binary storage is provisioned separately; storage_path is a private object key and public URLs are refused by constraint.';

/** Validates declared file type and size against the configured policy. */
create or replace function private.validate_procurement_document()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  allowed text;
  max_mb numeric;
begin
  select value_text into allowed from public.procurement_settings where key = 'allowed_document_mime_types';
  select value_numeric into max_mb from public.procurement_settings where key = 'max_document_size_mb';

  if allowed is not null and not (new.mime_type = any (string_to_array(replace(allowed, ' ', ''), ','))) then
    raise exception 'Document type % is not accepted. Permitted types: %', new.mime_type, allowed
      using errcode = 'check_violation';
  end if;

  if max_mb is not null and new.file_size_bytes > (max_mb * 1024 * 1024) then
    raise exception 'Document is larger than the permitted % MB', max_mb
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists procurement_documents_validate on public.procurement_documents;
create trigger procurement_documents_validate
  before insert or update on public.procurement_documents
  for each row execute function private.validate_procurement_document();

-- ---------------------------------------------------------------------------
-- 3. Comments
-- ---------------------------------------------------------------------------

create table if not exists public.procurement_comments (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  body text not null,
  visibility text not null default 'internal',
  author_profile_id uuid references public.profiles (id) on delete set null on update cascade,
  author_employee_id uuid references public.employees (id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  constraint procurement_comments_body_present check (length(btrim(body)) >= 2),
  constraint procurement_comments_visibility_check
    check (visibility in ('internal', 'supplier_visible')),
  constraint procurement_comments_entity_check
    check (entity_type in ('purchase_requisition', 'supplier_quotation', 'purchase_order',
                           'purchase_order_amendment', 'goods_receipt', 'supplier_advance',
                           'supplier_reconciliation'))
);

create index if not exists procurement_comments_entity_idx
  on public.procurement_comments (entity_type, entity_id, created_at desc);

comment on table public.procurement_comments is
  'Threaded remarks per document. visibility separates internal notes from text intended for the supplier.';

-- ---------------------------------------------------------------------------
-- 4. Legacy mapping readiness (§10)
-- ---------------------------------------------------------------------------
-- The legacy PHP/MySQL database is not connected to and is not modified. These tables are where an
-- authorised migration records what it found and how each legacy row maps — including the rows it
-- could not map, which are the ones that matter most.

create table if not exists public.procurement_legacy_imports (
  id uuid primary key default gen_random_uuid(),
  source_system text not null default 'legacy_php_mysql',
  source_table text not null,
  description text,
  status text not null default 'draft',
  total_rows int not null default 0,
  mapped_rows int not null default 0,
  unmatched_rows int not null default 0,
  ambiguous_rows int not null default 0,
  duplicate_rows int not null default 0,
  orphan_rows int not null default 0,
  notes text,
  created_by uuid references public.profiles (id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint procurement_legacy_imports_status_check
    check (status in ('draft', 'analysed', 'reviewed', 'approved', 'imported', 'abandoned')),
  constraint procurement_legacy_imports_counts_non_negative
    check (total_rows >= 0 and mapped_rows >= 0 and unmatched_rows >= 0 and ambiguous_rows >= 0
           and duplicate_rows >= 0 and orphan_rows >= 0)
);

comment on table public.procurement_legacy_imports is
  'One row per legacy procurement table analysed. Records the reconciliation census before any import is authorised.';

create table if not exists public.procurement_legacy_import_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.procurement_legacy_imports (id) on delete cascade on update cascade,
  source_table text not null,
  source_record_id text not null,
  source_reference text,
  source_date date,
  source_amount numeric(20, 2),
  source_currency_code text,
  target_entity text,
  target_record_id uuid,
  match_status text not null default 'unmatched',
  match_confidence numeric(5, 2),
  match_notes text,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  constraint procurement_legacy_import_rows_status_check
    check (match_status in ('matched', 'unmatched', 'ambiguous', 'duplicate', 'orphan', 'ignored')),
  constraint procurement_legacy_import_rows_confidence_range
    check (match_confidence is null or (match_confidence >= 0 and match_confidence <= 100)),
  constraint procurement_legacy_import_rows_unique unique (import_id, source_table, source_record_id)
);

create index if not exists procurement_legacy_import_rows_import_idx
  on public.procurement_legacy_import_rows (import_id, match_status);

comment on table public.procurement_legacy_import_rows is
  'Per-row mapping decision with its confidence and reason. A row without target_record_id is an unresolved legacy transaction, not a silent skip.';
