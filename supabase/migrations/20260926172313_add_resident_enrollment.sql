begin;
-- Service-only, invoker rights: the API authenticates the actor; this transaction
-- also checks their current community assignment before creating any records.
create or replace function public.server_enroll_resident(
  p_request_id uuid, p_actor uuid, p_community_id uuid, p_full_name text,
  p_house_number text, p_block text, p_category text, p_verified boolean,
  p_consent boolean, p_verification_reason text
) returns uuid language plpgsql security invoker set search_path = public, pg_temp as $$
declare resident_id uuid; membership_id uuid;
begin
  if not exists (select 1 from public.account_links a
    join public.role_assignments r on r.account_link_id = a.id
    join public.communities c on c.id = p_community_id and c.active
    where a.id = p_actor and a.status = 'active' and r.active
      and (r.role = 'owner' or (r.role = 'community_staff' and r.community_id = p_community_id)))
  then raise exception 'Enrollment is not allowed for this community' using errcode = '42501'; end if;
  if p_request_id is null or p_full_name is null or char_length(trim(p_full_name)) not between 2 and 160
    or p_house_number is null or char_length(trim(p_house_number)) not between 1 and 40
    or p_category is null or p_category not in ('senior', 'community_member')
    or coalesce(char_length(p_block), 0) > 80 or p_verified is distinct from true or p_consent is distinct from true
    or p_verification_reason is null or char_length(trim(p_verification_reason)) not between 3 and 500
  then raise exception 'Verified identity and enrollment consent are required' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select id into resident_id from public.residents where id = p_request_id
    and community_id = p_community_id and full_name = trim(p_full_name)
    and house_number = trim(p_house_number) and category = p_category;
  if resident_id is not null then return resident_id; end if;
  insert into public.residents(id, community_id, full_name, house_number, block, category, membership_state)
    values(p_request_id, p_community_id, trim(p_full_name), trim(p_house_number), nullif(trim(p_block), ''), p_category, 'active')
    returning id into resident_id;
  insert into public.memberships(resident_id, community_id, status, activated_at)
    values(resident_id, p_community_id, 'active', now()) returning id into membership_id;
  insert into public.verification_records(resident_id, membership_id, method, reason, verified_by)
    values(resident_id, membership_id, 'in_person_colony_record', trim(p_verification_reason), p_actor);
  insert into public.consent_records(resident_id, membership_id, granted, recorded_by)
    values(resident_id, membership_id, true, p_actor);
  return resident_id;
end $$;
revoke all on function public.server_enroll_resident(uuid,uuid,uuid,text,text,text,text,boolean,boolean,text) from public, anon, authenticated;
grant execute on function public.server_enroll_resident(uuid,uuid,uuid,text,text,text,text,boolean,boolean,text) to service_role;
commit;
