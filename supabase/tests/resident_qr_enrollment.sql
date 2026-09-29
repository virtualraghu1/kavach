-- Run in the isolated pilot. All fixtures, including the Auth identity, roll back.
begin;
do $$
declare
  staff uuid; owner_id uuid; home uuid; elsewhere uuid; rid uuid; mid uuid;
  auth_id uuid := gen_random_uuid(); request_id uuid; result record; caught boolean;
  uname text := 'qr.' || substr(replace(gen_random_uuid()::text,'-',''),1,24);
  internal_email text := 'auth-' || gen_random_uuid()::text || '@accounts.kavach.invalid';
begin
  select a.id,r.community_id into staff,home from public.account_links a
    join public.role_assignments r on r.account_link_id=a.id
    where a.status='active' and r.active and r.role='community_staff' limit 1;
  select a.id into owner_id from public.account_links a join public.role_assignments r on r.account_link_id=a.id
    where a.status='active' and r.active and r.role='owner' limit 1;
  if staff is null or owner_id is null then raise exception 'pilot staff/owner required'; end if;
  insert into public.communities(slug,display_name) values('qr-'||gen_random_uuid()::text,'Fictional QR test community') returning id into elsewhere;
  insert into public.residents(community_id,full_name,house_number,membership_state)
    values(elsewhere,'Fictional QR Resident','QR-TEST','active') returning id into rid;
  insert into public.memberships(resident_id,community_id,status,activated_at) values(rid,elsewhere,'active',now()) returning id into mid;

  caught:=false;
  begin perform public.server_issue_resident_qr(rid,staff,repeat('a',64),now()+interval '1 day');
  exception when insufficient_privilege then caught:=true; end;
  if not caught then raise exception 'cross-community issue was allowed'; end if;
  perform public.server_issue_resident_qr(rid,owner_id,repeat('a',64),now()+interval '1 day');
  perform public.server_issue_resident_qr(rid,owner_id,repeat('b',64),now()+interval '1 day');
  caught:=false;
  begin perform public.server_request_resident_qr(repeat('a',64),uname); exception when others then caught:=true; end;
  if not caught then raise exception 'superseded QR was accepted'; end if;
  perform public.server_request_resident_qr(repeat('b',64),uname);
  select id into request_id from public.resident_qr_requests where resident_id=rid and state='pending';
  if request_id is null or exists(select 1 from public.account_links where resident_id=rid) then raise exception 'request created access or was not persisted'; end if;
  caught:=false;
  begin perform public.server_request_resident_qr(repeat('b',64),uname); exception when others then caught:=true; end;
  if not caught then raise exception 'QR replay was accepted'; end if;
  caught:=false;
  begin perform 1 from public.server_approve_resident_qr(request_id,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),auth_id,internal_email,uname,rid,decode(repeat('ab',32),'hex'),now()+interval '5 minutes',owner_id);
  exception when others then caught:=true; end;
  if not caught then raise exception 'unverified resident was approved'; end if;
  if not exists(select 1 from public.resident_qr_requests where id=request_id and state='pending') then raise exception 'failed approval consumed request'; end if;
  insert into public.verification_records(resident_id,membership_id,method,reason,verified_by) values(rid,mid,'in_person_colony_record','Fictional rollback test',owner_id);
  insert into public.consent_records(resident_id,membership_id,granted,recorded_by) values(rid,mid,true,owner_id);
  insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values(auth_id,internal_email,now(),'{"kavach_internal_identity":true}'::jsonb);
  caught:=false;
  begin perform 1 from public.server_approve_resident_qr(request_id,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),auth_id,internal_email,uname,rid,decode(repeat('ab',32),'hex'),now()+interval '5 minutes',staff);
  exception when others then caught:=true; end;
  if not caught then raise exception 'cross-community approval was allowed'; end if;
  select * into result from public.server_approve_resident_qr(request_id,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),auth_id,internal_email,uname,rid,decode(repeat('ab',32),'hex'),now()+interval '5 minutes',owner_id);
  if result.account_link_id is null or not exists(select 1 from public.resident_qr_requests where id=request_id and state='approved') then raise exception 'approval failed'; end if;
  if not exists(select 1 from public.account_links where id=result.account_link_id and status='pending') then raise exception 'approval activated account before password setup'; end if;
  caught:=false;
  begin perform 1 from public.server_approve_resident_qr(request_id,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),auth_id,internal_email,uname,rid,decode(repeat('ab',32),'hex'),now()+interval '5 minutes',owner_id);
  exception when others then caught:=true; end;
  if not caught then raise exception 'approval replay was accepted'; end if;
  if has_table_privilege('anon','public.resident_qr_invites','select') or has_table_privilege('authenticated','public.resident_qr_requests','update')
    or has_function_privilege('anon','public.server_request_resident_qr(text,text)','execute') then raise exception 'direct client permissions leaked'; end if;
end $$;
rollback;
