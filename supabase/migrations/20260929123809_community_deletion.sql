-- Recoverable removal keeps identity, consent and security history intact.
alter table public.communities add column deleted_at timestamptz;
alter table public.communities add column deleted_by uuid references public.account_links(id);
alter table public.communities add constraint deleted_community_inactive check (deleted_at is null or not active);

create function public.server_delete_community(p_community_id uuid, p_actor uuid, p_confirmation_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare target public.communities%rowtype; affected_accounts uuid[];
begin
  if not exists(select 1 from public.account_links a join public.role_assignments r on r.account_link_id=a.id
    where a.id=p_actor and a.status='active' and r.active and r.role='owner')
  then raise exception 'Owner access required' using errcode='42501'; end if;
  select * into target from public.communities where id=p_community_id for update;
  if target.id is null or p_confirmation_name is distinct from target.display_name then raise exception 'Community name confirmation required'; end if;
  if target.deleted_at is not null then return; end if;
  update public.communities set active=false,deleted_at=clock_timestamp(),deleted_by=p_actor where id=p_community_id;
  update public.role_assignments set active=false,revoked_at=clock_timestamp() where community_id=p_community_id and active;
  select coalesce(array_agg(a.id),array[]::uuid[]) into affected_accounts from public.account_links a
  where a.account_kind <> 'owner' and (
    a.resident_id in (select id from public.residents where community_id=p_community_id)
    or (a.account_kind='staff' and exists(select 1 from public.role_assignments r where r.account_link_id=a.id and r.community_id=p_community_id)
      and not exists(select 1 from public.role_assignments r join public.communities c on c.id=r.community_id and c.active where r.account_link_id=a.id and r.active))
  );
  update public.account_links set status='disabled',revoked_before=clock_timestamp() where id=any(affected_accounts);
  update public.memberships set status='inactive',deactivated_at=clock_timestamp() where community_id=p_community_id and status <> 'inactive';
  update public.residents set membership_state='inactive' where community_id=p_community_id;
  update public.app_installations set revoked_at=clock_timestamp() where account_link_id=any(affected_accounts) and revoked_at is null;
  update kavach_private.account_grants set state='revoked',revoked_at=clock_timestamp() where account_link_id=any(affected_accounts) and state in ('pending','claimed');
  update public.resident_qr_invites set state='revoked' where resident_id in (select id from public.residents where community_id=p_community_id) and state='active';
  update public.resident_qr_requests set state='rejected',reviewed_by=p_actor,reviewed_at=clock_timestamp() where resident_id in (select id from public.residents where community_id=p_community_id) and state='pending';
  insert into public.security_events(community_id,actor_account_id,event_type,outcome,details)
    values(p_community_id,p_actor,'community_deleted','success',jsonb_build_object('recoverable',true,'accounts_disabled',cardinality(affected_accounts)));
end $$;
revoke all on function public.server_delete_community(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.server_delete_community(uuid,uuid,text) to service_role;
