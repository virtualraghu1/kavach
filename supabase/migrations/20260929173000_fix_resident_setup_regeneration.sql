-- Qualify the grant column: RETURNS TABLE also declares account_link_id as a PL/pgSQL variable.
create or replace function public.server_regenerate_resident_setup(
  p_resident_id uuid, p_password_operation_id uuid, p_grant_id uuid,
  p_code_digest bytea, p_expires_at timestamptz, p_created_by uuid
)
returns table (account_link_id uuid, grant_id uuid, expires_at timestamptz)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  target_account public.account_links%rowtype;
  target_membership public.memberships%rowtype;
  target_community_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('kavach:resident:' || p_resident_id::text, 0));
  if p_code_digest is null or octet_length(p_code_digest) <> 32
    or p_expires_at <= clock_timestamp()
    or p_expires_at > clock_timestamp() + interval '10 minutes' then
    raise exception 'invalid setup grant';
  end if;
  select account.* into target_account from public.account_links account
  where account.resident_id = p_resident_id and account.account_kind = 'resident'
    and account.status = 'pending' for update;
  select membership.* into target_membership from public.memberships membership
  join public.residents resident on resident.id = membership.resident_id
    and resident.community_id = membership.community_id
  join public.communities community on community.id = membership.community_id
  where membership.resident_id = p_resident_id
    and membership.status = 'active' and resident.membership_state = 'active'
    and community.active
    and exists (select 1 from public.verification_records verification
      where verification.membership_id = membership.id and verification.valid)
    and exists (select 1 from public.consent_records consent
      where consent.membership_id = membership.id and consent.consent_type = 'enrollment'
        and consent.granted and consent.withdrawn_at is null);
  target_community_id := target_membership.community_id;
  if target_account.id is null or target_membership.id is null
    or not exists (select 1 from public.role_assignments assignment
      where assignment.account_link_id = target_account.id
        and assignment.community_id = target_community_id
        and assignment.role = 'resident' and assignment.active)
    or not exists (select 1 from public.account_links actor
      join public.role_assignments assignment on assignment.account_link_id = actor.id
      where actor.id = p_created_by and actor.status = 'active' and assignment.active
        and (assignment.role = 'owner' or
          (assignment.role = 'community_staff' and assignment.community_id = target_community_id))) then
    raise exception 'resident setup unavailable';
  end if;
  -- Claimed grants may represent an in-flight Auth write and require manual
  -- reconciliation, not automatic replacement.
  if exists (select 1 from kavach_private.account_grants grant_row
    where grant_row.account_link_id = target_account.id and grant_row.purpose = 'setup'
      and grant_row.state = 'claimed') then
    raise exception 'setup in progress';
  end if;
  update kavach_private.account_grants as grant_row set state = 'revoked', revoked_at = clock_timestamp()
  where grant_row.account_link_id = target_account.id and grant_row.purpose = 'setup' and grant_row.state = 'pending';
  insert into kavach_private.account_operations
    (id, account_link_id, operation_type, state, external_auth_user_id)
  values (p_password_operation_id, target_account.id, 'set_password',
    'started', target_account.auth_user_id);
  insert into kavach_private.account_grants
    (id, operation_id, account_link_id, membership_id, purpose,
     code_digest, state, expires_at, created_by)
  values (p_grant_id, p_password_operation_id, target_account.id, target_membership.id,
    'setup', p_code_digest, 'pending', p_expires_at, p_created_by);
  insert into public.security_events
    (community_id, actor_account_id, target_resident_id, event_type, outcome, details)
  values (target_community_id, p_created_by, p_resident_id,
    'resident_setup_regenerated', 'success',
    jsonb_build_object('target_account_id', target_account.id));
  return query select target_account.id, p_grant_id, p_expires_at;
end;
$$;
