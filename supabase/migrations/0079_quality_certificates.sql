-- 0079 — certificates of analysis
--
-- A certificate is a snapshot, not a live view. It copies the results, the limits they were judged against, the
-- specification version and the disposition reference at the moment of issue, so a certificate can never change
-- meaning afterwards. Reissuing supersedes the previous certificate and keeps both, which is what a customer
-- audit expects to see.
--
-- What this file refuses to do, and says so in the schema rather than in a policy document:
--   * it does not claim an accreditation. `accreditation_reference` exists so a real reference can be copied from
--     a real certificate of accreditation, and stays null otherwise;
--   * it does not name a laboratory. `laboratory_name` is whatever the company states for its own lab, and the
--     generated statement says the results were recorded in this system, not that an external body confirmed them;
--   * it does not invent a method, a standard, a clause or a test report number. Those fields are free text and
--     stay empty unless a person fills them from a source document.

create table if not exists public.quality_certificates (
  id uuid primary key default gen_random_uuid(),
  reference text not null,

  inspection_id uuid not null references public.quality_inspections (id) on delete restrict on update cascade,
  disposition_id uuid not null references public.quality_dispositions (id) on delete restrict on update cascade,
  lot_id uuid not null references public.inventory_lots (id) on delete restrict on update cascade,
  production_batch_id uuid references public.production_batches (id) on delete restrict on update cascade,
  product_id uuid not null references public.products (id) on delete restrict on update cascade,

  -- Customer comes from Phase 2 master data where it is known; the free-text consignee covers a shipment to a
  -- party that is not in the customer register yet.
  customer_id uuid references public.customers (id) on delete set null on update cascade,
  issued_to text,

  version int not null default 1,
  status text not null default 'issued',
  supersedes_id uuid references public.quality_certificates (id) on delete restrict on update cascade,
  superseded_by_id uuid references public.quality_certificates (id) on delete restrict on update cascade,

  -- Company-supplied, never generated. Null means "not stated on this certificate".
  laboratory_name text,
  accreditation_reference text,
  remarks text,

  -- The evidence, frozen. Shape: { specification: {...}, results: [...], disposition: {...}, quantities: {...} }.
  content jsonb not null,
  statement text not null,

  issued_by uuid references public.profiles (id) on delete set null on update cascade,
  issued_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.profiles (id) on delete set null on update cascade,
  void_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint quality_certificates_reference_unique unique (reference),
  constraint quality_certificates_version_positive check (version > 0),
  constraint quality_certificates_status_check check (status in ('issued', 'superseded', 'void')),
  constraint quality_certificates_void_shape
    check ((status = 'void' and voided_at is not null and void_reason is not null) or (status <> 'void')),
  constraint quality_certificates_self_supersede check (supersedes_id is null or supersedes_id <> id)
);

create index if not exists quality_certificates_lot_idx on public.quality_certificates (lot_id, issued_at desc);
create index if not exists quality_certificates_inspection_idx on public.quality_certificates (inspection_id);

comment on table public.quality_certificates is
  'Issued certificate of analysis. `content` is a frozen snapshot of the results and the limits they were judged against; a later specification change cannot rewrite it.';

comment on column public.quality_certificates.accreditation_reference is
  'Company-supplied accreditation reference copied from a real certificate. Null means none is claimed. The system never generates one.';

/**
 * Issues a certificate of analysis from an approved inspection whose disposition was release.
 *
 * The content snapshot is assembled here, in the database, from the rows that already exist. That is deliberate:
 * a certificate built in the application from a query is only as trustworthy as the query, and this is the
 * document a customer will hold the company to.
 */
create or replace function public.quality_issue_certificate(
  p_inspection_id uuid,
  p_issued_to text default null,
  p_customer_id uuid default null,
  p_remarks text default null,
  p_laboratory_name text default null,
  p_accreditation_reference text default null
)
returns public.quality_certificates
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inspection public.quality_inspections;
  spec public.quality_specifications;
  decision public.quality_dispositions;
  lot public.inventory_lots;
  product public.products;
  previous public.quality_certificates;
  certificate public.quality_certificates;
  results jsonb;
  statement_text text;
  require_release boolean;
begin
  if auth.uid() is not null and not private.has_permission('quality.certificate.issue') then
    raise exception 'Issuing a certificate requires permission quality.certificate.issue'
      using errcode = 'insufficient_privilege';
  end if;

  select * into inspection from public.quality_inspections where id = p_inspection_id;
  if inspection.id is null then
    raise exception 'That inspection does not exist, or you cannot see it' using errcode = 'check_violation';
  end if;
  if inspection.status <> 'approved' then
    raise exception 'Inspection % is %; a certificate can only be issued from an approved inspection',
      inspection.reference, inspection.status
      using errcode = 'check_violation';
  end if;

  select * into decision
    from public.quality_dispositions d
   where d.inspection_id = inspection.id and d.status = 'recorded';

  if decision.id is null then
    raise exception 'Inspection % has no recorded disposition, so there is nothing a certificate could attest',
      inspection.reference
      using errcode = 'check_violation';
  end if;

  require_release := public.quality_setting_boolean('certificate.require_release_disposition', true);
  if require_release and decision.disposition <> 'release' then
    raise exception 'Inspection % carries a % disposition. A certificate of analysis is only issued for released material.',
      inspection.reference, decision.disposition
      using errcode = 'check_violation';
  end if;

  if inspection.lot_id is null then
    raise exception 'Inspection % is not linked to a lot', inspection.reference using errcode = 'check_violation';
  end if;

  select * into lot from public.inventory_lots where id = inspection.lot_id;
  select * into spec from public.quality_specifications where id = inspection.specification_id;
  select * into product from public.products where id = lot.product_id;

  select coalesce(jsonb_agg(row_json order by line_number), '[]'::jsonb)
    into results
    from (
      select
        row_number() over (order by qsp.line_number) as line_number,
        jsonb_build_object(
          'parameter', qp.name,
          'parameter_code', qp.code,
          'result_type', qp.result_type,
          'value_numeric', r.value_numeric,
          'value_text', r.value_text,
          'unit', u.code,
          'min_value', r.judged_min,
          'max_value', r.judged_max,
          'expected_text', r.judged_expected_text,
          'conformance', r.conformance,
          'method_reference', coalesce(qsp.method_reference, qp.method_reference),
          'criticality', qsp.criticality
        ) as row_json
        from public.quality_inspection_results r
        join public.quality_specification_parameters qsp on qsp.id = r.specification_parameter_id
        join public.quality_parameters qp on qp.id = r.parameter_id
        left join public.units_of_measure u on u.id = r.unit_id
       where r.inspection_id = inspection.id
    ) x;

  statement_text :=
    'Results recorded in the Pluck Agro ERP against specification ' || spec.reference
    || ' version ' || spec.version::text
    || ' and released by disposition ' || decision.reference
    || '. This certificate reproduces the results recorded on inspection ' || inspection.reference
    || '; it is not a statement by any external laboratory or accreditation body.';

  select * into previous
    from public.quality_certificates c
   where c.lot_id = lot.id and c.status = 'issued'
   order by c.version desc
   limit 1;

  insert into public.quality_certificates
    (reference, inspection_id, disposition_id, lot_id, production_batch_id, product_id,
     customer_id, issued_to, version, supersedes_id, laboratory_name, accreditation_reference, remarks,
     content, statement, issued_by)
  values
    (private.next_quality_reference('quality_certificate'), inspection.id, decision.id, lot.id,
     inspection.production_batch_id, lot.product_id, p_customer_id, p_issued_to,
     coalesce(previous.version, 0) + 1, previous.id, p_laboratory_name, p_accreditation_reference, p_remarks,
     jsonb_build_object(
       'product', jsonb_build_object('code', product.code, 'name', product.name),
       'lot', jsonb_build_object('reference', lot.lot_reference, 'received_date', lot.received_date,
                                 'expiry_date', lot.expiry_date, 'grade', lot.grade),
       'specification', jsonb_build_object('reference', spec.reference, 'version', spec.version,
                                            'stage', spec.stage, 'method_reference', spec.method_reference),
       'inspection', jsonb_build_object('reference', inspection.reference,
                                         'inspected_at', inspection.inspected_at,
                                         'approved_at', inspection.approved_at,
                                         'result_summary', inspection.result_summary),
       'disposition', jsonb_build_object('reference', decision.reference,
                                          'disposition', decision.disposition,
                                          'quantity', decision.quantity,
                                          'decided_at', decision.decided_at),
       'results', results
     ),
     statement_text, auth.uid())
  returning * into certificate;

  if previous.id is not null then
    update public.quality_certificates
       set status = 'superseded',
           superseded_by_id = certificate.id,
           updated_at = now()
     where id = previous.id;
  end if;

  return certificate;
end;
$$;

comment on function public.quality_issue_certificate(uuid, text, uuid, text, text, text) is
  'Issues a certificate of analysis as a frozen snapshot of an approved, released inspection. Supersedes any previously issued certificate for the same lot rather than editing it.';

create or replace function public.quality_void_certificate(p_certificate_id uuid, p_reason text)
returns public.quality_certificates
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  certificate public.quality_certificates;
begin
  if auth.uid() is not null and not private.has_permission('quality.certificate.issue') then
    raise exception 'Voiding a certificate requires permission quality.certificate.issue'
      using errcode = 'insufficient_privilege';
  end if;

  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'Voiding a certificate requires a reason of at least 10 characters'
      using errcode = 'check_violation';
  end if;

  select * into certificate from public.quality_certificates where id = p_certificate_id for update;
  if certificate.id is null then
    raise exception 'That certificate does not exist, or you cannot see it' using errcode = 'check_violation';
  end if;
  if certificate.status <> 'issued' then
    raise exception 'Certificate % is % and cannot be voided', certificate.reference, certificate.status
      using errcode = 'check_violation';
  end if;

  update public.quality_certificates
     set status = 'void',
         voided_at = now(),
         voided_by = coalesce(auth.uid(), voided_by),
         void_reason = p_reason,
         updated_at = now()
   where id = certificate.id
  returning * into certificate;

  return certificate;
end;
$$;
