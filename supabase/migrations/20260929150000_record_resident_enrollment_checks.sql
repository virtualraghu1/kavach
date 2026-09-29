begin;

-- Office staff can finish verification and consent for an existing resident
-- before any account is created. The Edge Function calls this as service_role.
create function public.server_record_resident_enrollment_checks(
  p_resident_id uuid,
  p_actor uuid,
  p_reason text,
  p_verified boolean,
  p_consent boolean
) returns boolean language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  target_resident public.residents%rowtype;
  target_membership public.memberships%rowtype;
begin
  if p_resident_id is null or p_actor is null or p_verified is distinct from true
    or p_consent is distinct from true or p_reason is null
    or char_length(trim(p_reason)) not between 3 and 500
  then raise exception 'Identity verification and enrollment consent are required' using errcode = '22023'; end if;

  select * into target_resident from public.residents where id = p_resident_id for update;
  if target_resident.id is null or target_resident.membership_state <> 'active'
    or not exists (select 1 from public.communities c where c.id = target_resident.community_id and c.active)
  then raise exception 'Resident is not eligible for enrollment' using errcode = '22023'; end if;

  if not exists (select 1 from public.account_links actor
    join public.role_assignments role on role.account_link_id = actor.id
    where actor.id = p_actor and actor.status = 'active' and role.active
      and (role.role = 'owner' or (role.role = 'community_staff' and role.community_id = target_resident.community_id)))
  then raise exception 'Office authorization required' using errcode = '42501'; end if;

  if exists (select 1 from public.account_links a where a.resident_id = p_resident_id)
  then raise exception 'Resident already has an account' using errcode = '22023'; end if;

  select * into target_membership from public.memberships
    where resident_id = p_resident_id and community_id = target_resident.community_id
      and status = 'active' for update;
  if target_membership.id is null
  then raise exception 'Active membership required' using errcode = '22023'; end if;

  if not exists (select 1 from public.verification_records v
    where v.membership_id = target_membership.id and v.valid)
  then
    insert into public.verification_records(resident_id, membership_id, method, reason, verified_by)
      values(p_resident_id, target_membership.id, 'in_person_colony_record', trim(p_reason), p_actor);
  end if;
  if not exists (select 1 from public.consent_records c
    where c.membership_id = target_membership.id and c.consent_type = 'enrollment'
      and c.granted and c.withdrawn_at is null)
  then
    insert into public.consent_records(resident_id, membership_id, granted, recorded_by)
      values(p_resident_id, target_membership.id, true, p_actor);
  end if;
  insert into public.security_events(community_id, actor_account_id, target_resident_id, event_type, outcome, details)
    values(target_resident.community_id, p_actor, p_resident_id,
      'resident_enrollment_checks_recorded', 'success', '{}'::jsonb);
  return true;
end $$;

revoke all on function public.server_record_resident_enrollment_checks(uuid,uuid,text,boolean,boolean) from public, anon, authenticated;
grant execute on function public.server_record_resident_enrollment_checks(uuid,uuid,text,boolean,boolean) to service_role;

commit;
