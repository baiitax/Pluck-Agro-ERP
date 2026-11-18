-- 0081 — quality row-level security and privileges
--
-- Posture, consistent with Phases 2, 3 and 4:
--   * configuration tables (numbering, lifecycles, parameters, sampling plans) are readable by any active
--     profile, because forms need them, and writable only with the matching manage permission;
--   * evidence tables (results) are readable with a view permission and writable with the record permission;
--   * the three tables that change what stock may be used — dispositions, holds and certificates — have **no
--     insert, update or delete policy and no insert, update or delete grant**. They are written only by the
--     `security definer` functions in 0077 and 0079, which assert the quality permission themselves. That is
--     deliberate: if a client could insert a disposition directly, it could release a lot without an inspection,
--     which would make the whole phase decorative.
--
-- Every table has RLS enabled. Default deny: a table with no matching policy returns nothing.

-- ---------------------------------------------------------------------------
-- 1. Enable RLS
-- ---------------------------------------------------------------------------

alter table public.quality_numbering enable row level security;
alter table public.quality_status_transitions enable row level security;
alter table public.quality_settings enable row level security;
alter table public.quality_status_history enable row level security;
alter table public.quality_parameters enable row level security;
alter table public.quality_specifications enable row level security;
alter table public.quality_specification_parameters enable row level security;
alter table public.quality_sampling_plans enable row level security;
alter table public.quality_inspections enable row level security;
alter table public.quality_samples enable row level security;
alter table public.quality_inspection_results enable row level security;
alter table public.quality_dispositions enable row level security;
alter table public.quality_holds enable row level security;
alter table public.quality_ncrs enable row level security;
alter table public.quality_capa_actions enable row level security;
alter table public.quality_certificates enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Configuration
-- ---------------------------------------------------------------------------

drop policy if exists quality_numbering_select on public.quality_numbering;
create policy quality_numbering_select on public.quality_numbering
  for select to authenticated using (private.is_active_profile());

drop policy if exists quality_numbering_write on public.quality_numbering;
create policy quality_numbering_write on public.quality_numbering
  for all to authenticated
  using (private.has_permission('settings.system.manage'))
  with check (private.has_permission('settings.system.manage'));

drop policy if exists quality_status_transitions_select on public.quality_status_transitions;
create policy quality_status_transitions_select on public.quality_status_transitions
  for select to authenticated using (private.is_active_profile());

drop policy if exists quality_status_transitions_write on public.quality_status_transitions;
create policy quality_status_transitions_write on public.quality_status_transitions
  for all to authenticated
  using (private.has_permission('settings.system.manage'))
  with check (private.has_permission('settings.system.manage'));

drop policy if exists quality_settings_select on public.quality_settings;
create policy quality_settings_select on public.quality_settings
  for select to authenticated using (private.is_active_profile());

drop policy if exists quality_settings_write on public.quality_settings;
create policy quality_settings_write on public.quality_settings
  for all to authenticated
  using (private.has_permission('settings.system.manage'))
  with check (private.has_permission('settings.system.manage'));

drop policy if exists quality_status_history_select on public.quality_status_history;
create policy quality_status_history_select on public.quality_status_history
  for select to authenticated
  using (private.has_any_permission(array[
    'quality.inspection.view', 'quality.specification.view', 'quality.ncr.view', 'quality.capa.view'
  ]));

drop policy if exists quality_parameters_select on public.quality_parameters;
create policy quality_parameters_select on public.quality_parameters
  for select to authenticated
  using (private.has_any_permission(array['quality.parameter.view', 'quality.specification.view']));

drop policy if exists quality_parameters_write on public.quality_parameters;
create policy quality_parameters_write on public.quality_parameters
  for all to authenticated
  using (private.has_permission('quality.parameter.manage'))
  with check (private.has_permission('quality.parameter.manage'));

drop policy if exists quality_sampling_plans_select on public.quality_sampling_plans;
create policy quality_sampling_plans_select on public.quality_sampling_plans
  for select to authenticated
  using (private.has_any_permission(array['quality.sampling.view', 'quality.inspection.view']));

drop policy if exists quality_sampling_plans_write on public.quality_sampling_plans;
create policy quality_sampling_plans_write on public.quality_sampling_plans
  for all to authenticated
  using (private.has_permission('quality.sampling.manage'))
  with check (private.has_permission('quality.sampling.manage'));

-- ---------------------------------------------------------------------------
-- 3. Specifications
-- ---------------------------------------------------------------------------

drop policy if exists quality_specifications_select on public.quality_specifications;
create policy quality_specifications_select on public.quality_specifications
  for select to authenticated
  using (private.has_permission('quality.specification.view'));

drop policy if exists quality_specifications_insert on public.quality_specifications;
create policy quality_specifications_insert on public.quality_specifications
  for insert to authenticated
  with check (private.has_permission('quality.specification.create'));

drop policy if exists quality_specifications_update on public.quality_specifications;
create policy quality_specifications_update on public.quality_specifications
  for update to authenticated
  using (private.has_permission('quality.specification.update'))
  with check (private.has_permission('quality.specification.update'));

drop policy if exists quality_specification_parameters_select on public.quality_specification_parameters;
create policy quality_specification_parameters_select on public.quality_specification_parameters
  for select to authenticated
  using (private.has_permission('quality.specification.view'));

drop policy if exists quality_specification_parameters_write on public.quality_specification_parameters;
create policy quality_specification_parameters_write on public.quality_specification_parameters
  for all to authenticated
  using (private.has_permission('quality.specification.update'))
  with check (private.has_permission('quality.specification.update'));

-- ---------------------------------------------------------------------------
-- 4. Inspections, samples and results
-- ---------------------------------------------------------------------------

drop policy if exists quality_inspections_select on public.quality_inspections;
create policy quality_inspections_select on public.quality_inspections
  for select to authenticated
  using (private.has_any_permission(array['quality.inspection.view', 'quality.result.view']));

drop policy if exists quality_inspections_insert on public.quality_inspections;
create policy quality_inspections_insert on public.quality_inspections
  for insert to authenticated
  with check (private.has_permission('quality.inspection.manage'));

drop policy if exists quality_inspections_update on public.quality_inspections;
create policy quality_inspections_update on public.quality_inspections
  for update to authenticated
  using (private.has_permission('quality.inspection.manage'))
  with check (private.has_permission('quality.inspection.manage'));

drop policy if exists quality_samples_select on public.quality_samples;
create policy quality_samples_select on public.quality_samples
  for select to authenticated
  using (private.has_permission('quality.inspection.view'));

drop policy if exists quality_samples_write on public.quality_samples;
create policy quality_samples_write on public.quality_samples
  for all to authenticated
  using (private.has_permission('quality.inspection.manage'))
  with check (private.has_permission('quality.inspection.manage'));

drop policy if exists quality_inspection_results_select on public.quality_inspection_results;
create policy quality_inspection_results_select on public.quality_inspection_results
  for select to authenticated
  using (private.has_any_permission(array['quality.result.view', 'quality.inspection.view']));

drop policy if exists quality_inspection_results_insert on public.quality_inspection_results;
create policy quality_inspection_results_insert on public.quality_inspection_results
  for insert to authenticated
  with check (private.has_permission('quality.result.record'));

drop policy if exists quality_inspection_results_update on public.quality_inspection_results;
create policy quality_inspection_results_update on public.quality_inspection_results
  for update to authenticated
  using (private.has_permission('quality.result.record'))
  with check (private.has_permission('quality.result.record'));

-- ---------------------------------------------------------------------------
-- 5. Evidence that decides what stock may be used — read-only to clients
-- ---------------------------------------------------------------------------

drop policy if exists quality_dispositions_select on public.quality_dispositions;
create policy quality_dispositions_select on public.quality_dispositions
  for select to authenticated
  using (private.has_any_permission(array['quality.disposition.view', 'quality.inspection.view']));

drop policy if exists quality_holds_select on public.quality_holds;
create policy quality_holds_select on public.quality_holds
  for select to authenticated
  using (private.has_any_permission(array['quality.disposition.view', 'quality.inspection.view']));

drop policy if exists quality_certificates_select on public.quality_certificates;
create policy quality_certificates_select on public.quality_certificates
  for select to authenticated
  using (private.has_any_permission(array['quality.certificate.view', 'quality.inspection.view']));

-- ---------------------------------------------------------------------------
-- 6. Non-conformance and CAPA
-- ---------------------------------------------------------------------------

drop policy if exists quality_ncrs_select on public.quality_ncrs;
create policy quality_ncrs_select on public.quality_ncrs
  for select to authenticated
  using (private.has_permission('quality.ncr.view'));

drop policy if exists quality_ncrs_insert on public.quality_ncrs;
create policy quality_ncrs_insert on public.quality_ncrs
  for insert to authenticated
  with check (private.has_permission('quality.ncr.create'));

drop policy if exists quality_ncrs_update on public.quality_ncrs;
create policy quality_ncrs_update on public.quality_ncrs
  for update to authenticated
  using (private.has_permission('quality.ncr.update'))
  with check (private.has_permission('quality.ncr.update'));

drop policy if exists quality_capa_actions_select on public.quality_capa_actions;
create policy quality_capa_actions_select on public.quality_capa_actions
  for select to authenticated
  using (private.has_permission('quality.capa.view'));

drop policy if exists quality_capa_actions_insert on public.quality_capa_actions;
create policy quality_capa_actions_insert on public.quality_capa_actions
  for insert to authenticated
  with check (private.has_permission('quality.capa.create'));

drop policy if exists quality_capa_actions_update on public.quality_capa_actions;
create policy quality_capa_actions_update on public.quality_capa_actions
  for update to authenticated
  using (private.has_permission('quality.capa.update'))
  with check (private.has_permission('quality.capa.update'));

-- ---------------------------------------------------------------------------
-- 7. Table privileges
-- ---------------------------------------------------------------------------
-- RLS decides which rows; GRANT decides whether the table may be touched at all. Both are stated explicitly so
-- a missing grant fails loudly instead of quietly returning an empty result.

grant select on
  public.quality_numbering, public.quality_status_transitions, public.quality_settings,
  public.quality_status_history, public.quality_parameters, public.quality_sampling_plans
  to authenticated;

grant insert, update on
  public.quality_numbering, public.quality_status_transitions, public.quality_settings,
  public.quality_parameters, public.quality_sampling_plans
  to authenticated;

grant select, insert, update on
  public.quality_specifications, public.quality_specification_parameters,
  public.quality_inspections, public.quality_samples, public.quality_inspection_results,
  public.quality_ncrs, public.quality_capa_actions
  to authenticated;

-- Read-only to clients, by design: these three are written by the functions that enforce the workflow.
grant select on
  public.quality_dispositions, public.quality_holds, public.quality_certificates
  to authenticated;

grant select on
  public.quality_specification_register, public.quality_inspection_register, public.quality_lot_status,
  public.quality_release_register, public.quality_open_holds, public.quality_ncr_register,
  public.quality_capa_register, public.quality_certificate_register, public.quality_lot_traceability,
  public.quality_dashboard_summary
  to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Function privileges
-- ---------------------------------------------------------------------------

grant execute on function public.quality_approve_specification(uuid, text) to authenticated, service_role;
grant execute on function public.quality_effective_specification(uuid, text) to authenticated, service_role;
grant execute on function public.quality_submit_inspection(uuid) to authenticated, service_role;
grant execute on function public.quality_approve_inspection(uuid, text) to authenticated, service_role;
grant execute on function public.quality_place_hold(uuid, numeric, text, text, uuid) to authenticated, service_role;
grant execute on function public.quality_release_hold(uuid, numeric, text) to authenticated, service_role;
grant execute on function public.quality_record_disposition(uuid, text, text, numeric, text, date) to authenticated, service_role;
grant execute on function public.quality_revoke_disposition(uuid, text) to authenticated, service_role;
grant execute on function public.quality_close_ncr(uuid, text, text) to authenticated, service_role;
grant execute on function public.quality_verify_capa(uuid, text) to authenticated, service_role;
grant execute on function public.quality_issue_certificate(uuid, text, uuid, text, text, text) to authenticated, service_role;
grant execute on function public.quality_void_certificate(uuid, text) to authenticated, service_role;
