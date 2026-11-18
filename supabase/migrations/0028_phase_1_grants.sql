-- 0028 — grants for Phase 1 tables
-- Applied after the Phase 1 seeds so newly created tables are covered.

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant select, insert, update, delete on public.employee_positions to authenticated';
    execute 'grant select on public.employee_department_history to authenticated';
    execute 'grant select, insert, update, delete on public.employee_emergency_contacts to authenticated';
    execute 'grant select, insert, update, delete on public.approval_authorities to authenticated';
    execute 'grant select, insert, update, delete on public.approval_delegations to authenticated';
    execute 'grant select, insert, update, delete on public.segregation_of_duties_rules to authenticated';
    execute 'grant select, insert, update, delete on public.sod_overrides to authenticated';
    execute 'grant select, insert, update, delete on public.access_review_records to authenticated';
    execute 'grant select on public.account_activity to authenticated';
    execute 'revoke insert, update, delete on public.employee_department_history from authenticated';
    execute 'revoke insert, update, delete on public.account_activity from authenticated';
    execute 'revoke insert, update, delete on public.audit_logs from authenticated';
    execute 'grant execute on function public.next_employee_number() to authenticated';
  end if;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon';
  end if;
end;
$$;
