begin;

-- The local and future Kavach projects require explicit Data API grants. RLS
-- bypass alone does not grant table privileges when auto exposure is disabled.
grant select, insert, update on public.communities to service_role;
grant select, insert, update on public.residents to service_role;
grant select, insert, update on public.memberships to service_role;
grant select, insert, update on public.account_links to service_role;
grant select, insert, update on public.role_assignments to service_role;
grant select, insert, update on public.consent_records to service_role;
grant select, insert, update on public.verification_records to service_role;
grant select, insert, update on public.app_installations to service_role;
grant select, insert on public.security_events to service_role;
grant usage, select on sequence public.security_events_id_seq to service_role;

-- Staff accounts do not have resident memberships. Resident setup and recovery
-- grants continue to carry a membership and are checked by their server flow.
alter table kavach_private.account_grants
  alter column membership_id drop not null;

create function public.server_create_staff_setup(
  p_provision_operation_id uuid,
  p_password_operation_id uuid,
  p_grant_id uuid,
  p_auth_user_id uuid,
  p_auth_email text,
  p_username text,
  p_display_name text,
  p_community_id uuid,
  p_code_digest bytea,
  p_expires_at timestamptz,
  p_created_by uuid
)
returns table (account_link_id uuid, grant_id uuid, expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  normalized_username text := lower(trim(p_username));
  normalized_email text := lower(trim(p_auth_email));
  normalized_name text := trim(p_display_name);
  auth_email text;
  auth_confirmed_at timestamptz;
  internal_identity boolean;
  new_account_id uuid;
  prior_operation kavach_private.account_operations%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('kavach:staff:' || normalized_username, 0));

  if normalized_username !~ '^[a-z][a-z0-9._-]{3,31}$' then
    raise exception 'invalid staff username';
  end if;
  if char_length(normalized_name) not between 2 and 160 then
    raise exception 'invalid staff display name';
  end if;
  if p_code_digest is null or octet_length(p_code_digest) <> 32 then
    raise exception 'invalid setup digest';
  end if;
  if p_expires_at <= clock_timestamp()
    or p_expires_at > clock_timestamp() + interval '10 minutes' then
    raise exception 'invalid setup expiry';
  end if;

  if not exists (
    select 1
    from public.account_links owner_account
    join public.role_assignments owner_role
      on owner_role.account_link_id = owner_account.id
    where owner_account.id = p_created_by
      and owner_account.status = 'active'
      and owner_role.role = 'owner'
      and owner_role.active
  ) then
    raise exception 'owner authorization required';
  end if;

  if not exists (
    select 1 from public.communities community
    where community.id = p_community_id and community.active
  ) then
    raise exception 'active community not found';
  end if;

  select * into prior_operation
  from kavach_private.account_operations operation
  where operation.id = p_provision_operation_id;
  if prior_operation.id is not null then
    if prior_operation.operation_type <> 'create_auth_user'
      or prior_operation.external_auth_user_id <> p_auth_user_id
      or prior_operation.state <> 'completed'
      or prior_operation.account_link_id is null then
      raise exception 'staff provisioning operation conflict';
    end if;
    return query
      select prior_operation.account_link_id, setup_grant.id, setup_grant.expires_at
      from kavach_private.account_grants setup_grant
      where setup_grant.operation_id = p_password_operation_id
        and setup_grant.account_link_id = prior_operation.account_link_id
      limit 1;
    return;
  end if;

  if exists (
    select 1 from kavach_private.login_identifiers login
    where login.identifier = normalized_username::extensions.citext
  ) then
    raise exception 'username already in use';
  end if;
  if exists (
    select 1 from public.account_links account
    where account.auth_user_id = p_auth_user_id
  ) then
    raise exception 'auth user already linked';
  end if;

  select lower(auth_user.email), auth_user.email_confirmed_at,
         coalesce((auth_user.raw_app_meta_data ->> 'kavach_internal_identity')::boolean, false)
    into auth_email, auth_confirmed_at, internal_identity
  from auth.users auth_user
  where auth_user.id = p_auth_user_id;

  if auth_email is null
    or auth_email <> normalized_email
    or normalized_email !~ '^[a-z0-9-]+@accounts[.]kavach[.]invalid$'
    or auth_confirmed_at is null
    or not internal_identity then
    raise exception 'invalid internal auth identity';
  end if;

  insert into public.account_links (
    auth_user_id, account_kind, status, display_name
  ) values (
    p_auth_user_id, 'staff', 'pending', normalized_name
  ) returning id into new_account_id;

  insert into kavach_private.login_identifiers (
    account_link_id, identifier, identifier_type, auth_email, verified
  ) values
    (new_account_id, normalized_username, 'username', normalized_email, true),
    (new_account_id, normalized_email, 'internal_alias', normalized_email, false);

  insert into public.role_assignments (
    account_link_id, community_id, role, active, granted_by
  ) values (
    new_account_id, p_community_id, 'community_staff', true, p_created_by
  );

  insert into kavach_private.account_operations (
    id, account_link_id, operation_type, state,
    external_auth_user_id, completed_at
  ) values (
    p_provision_operation_id, new_account_id, 'create_auth_user', 'completed',
    p_auth_user_id, clock_timestamp()
  );

  insert into kavach_private.account_operations (
    id, account_link_id, operation_type, state, external_auth_user_id
  ) values (
    p_password_operation_id, new_account_id, 'set_password', 'started',
    p_auth_user_id
  );

  insert into kavach_private.account_grants (
    id, operation_id, account_link_id, membership_id, purpose,
    code_digest, state, expires_at, created_by
  ) values (
    p_grant_id, p_password_operation_id, new_account_id, null, 'setup',
    p_code_digest, 'pending', p_expires_at, p_created_by
  );

  insert into public.security_events (
    community_id, actor_account_id, event_type, outcome, details
  ) values (
    p_community_id, p_created_by, 'staff_setup_issued', 'success',
    jsonb_build_object(
      'target_account_id', new_account_id,
      'operation_id', p_provision_operation_id
    )
  );

  return query select new_account_id, p_grant_id, p_expires_at;
end;
$$;

create function public.server_regenerate_staff_setup(
  p_account_link_id uuid,
  p_password_operation_id uuid,
  p_grant_id uuid,
  p_code_digest bytea,
  p_expires_at timestamptz,
  p_created_by uuid
)
returns table (grant_id uuid, expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_auth_user_id uuid;
  target_community_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('kavach:staff-account:' || p_account_link_id::text, 0));

  if p_code_digest is null or octet_length(p_code_digest) <> 32
    or p_expires_at <= clock_timestamp()
    or p_expires_at > clock_timestamp() + interval '10 minutes' then
    raise exception 'invalid setup grant';
  end if;

  if not exists (
    select 1
    from public.account_links owner_account
    join public.role_assignments owner_role
      on owner_role.account_link_id = owner_account.id
    where owner_account.id = p_created_by
      and owner_account.status = 'active'
      and owner_role.role = 'owner'
      and owner_role.active
  ) then
    raise exception 'owner authorization required';
  end if;

  select account.auth_user_id, assignment.community_id
    into target_auth_user_id, target_community_id
  from public.account_links account
  join public.role_assignments assignment
    on assignment.account_link_id = account.id
   and assignment.role = 'community_staff'
   and assignment.active
  join public.communities community
    on community.id = assignment.community_id and community.active
  where account.id = p_account_link_id
    and account.account_kind = 'staff'
    and account.status = 'pending'
  limit 1;

  if target_auth_user_id is null then
    raise exception 'pending staff account not found';
  end if;

  update kavach_private.account_operations operation
    set state = 'failed', error_code = 'grant_regenerated',
        completed_at = clock_timestamp()
  where operation.id in (
    select setup_grant.operation_id
    from kavach_private.account_grants setup_grant
    where setup_grant.account_link_id = p_account_link_id
      and setup_grant.purpose = 'setup'
      and setup_grant.state in ('pending', 'claimed')
  ) and operation.state = 'started';

  update kavach_private.account_grants
    set state = 'revoked', revoked_at = clock_timestamp()
  where account_link_id = p_account_link_id
    and purpose = 'setup'
    and state in ('pending', 'claimed');

  insert into kavach_private.account_operations (
    id, account_link_id, operation_type, state, external_auth_user_id
  ) values (
    p_password_operation_id, p_account_link_id, 'set_password', 'started',
    target_auth_user_id
  );

  insert into kavach_private.account_grants (
    id, operation_id, account_link_id, membership_id, purpose,
    code_digest, state, expires_at, created_by
  ) values (
    p_grant_id, p_password_operation_id, p_account_link_id, null, 'setup',
    p_code_digest, 'pending', p_expires_at, p_created_by
  );

  insert into public.security_events (
    community_id, actor_account_id, event_type, outcome, details
  ) values (
    target_community_id, p_created_by, 'staff_setup_regenerated', 'success',
    jsonb_build_object('target_account_id', p_account_link_id)
  );

  return query select p_grant_id, p_expires_at;
end;
$$;

create function public.server_begin_setup_redemption(
  p_username text,
  p_code_digest bytea
)
returns table (
  redemption_status text,
  auth_user_id uuid,
  operation_id uuid
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  normalized_username text := lower(trim(p_username));
  target_account_id uuid;
  target_auth_user_id uuid;
  target_account_status text;
  target_community_id uuid;
  target_grant kavach_private.account_grants%rowtype;
  next_attempts integer;
begin
  if normalized_username !~ '^[a-z][a-z0-9._-]{3,31}$'
    or p_code_digest is null or octet_length(p_code_digest) <> 32 then
    return query select 'invalid'::text, null::uuid, null::uuid;
    return;
  end if;

  select account.id, account.auth_user_id, account.status, assignment.community_id
    into target_account_id, target_auth_user_id, target_account_status, target_community_id
  from kavach_private.login_identifiers login
  join public.account_links account on account.id = login.account_link_id
  join public.role_assignments assignment
    on assignment.account_link_id = account.id
   and assignment.role = 'community_staff'
   and assignment.active
  join public.communities community
    on community.id = assignment.community_id and community.active
  where login.identifier = normalized_username::extensions.citext
    and login.identifier_type = 'username'
    and login.verified
    and account.account_kind = 'staff'
  limit 1;

  if target_account_id is null or target_account_status <> 'pending' then
    return query select 'invalid'::text, null::uuid, null::uuid;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('kavach:staff-account:' || target_account_id::text, 0));

  select setup_grant.* into target_grant
  from kavach_private.account_grants setup_grant
  where setup_grant.account_link_id = target_account_id
    and setup_grant.purpose = 'setup'
  order by setup_grant.created_at desc
  limit 1
  for update;

  if target_grant.id is null then
    return query select 'invalid'::text, null::uuid, null::uuid;
    return;
  end if;

  if target_grant.code_digest is distinct from p_code_digest then
    if target_grant.state = 'pending' and target_grant.expires_at > clock_timestamp() then
      next_attempts := least(5, target_grant.incorrect_attempts + 1);
      update kavach_private.account_grants
        set incorrect_attempts = next_attempts,
            state = case when next_attempts >= 5 then 'blocked' else state end
      where id = target_grant.id;
      insert into public.security_events (
        community_id, actor_account_id, event_type, outcome, details
      ) values (
        target_community_id, null, 'staff_setup_code_rejected',
        case when next_attempts >= 5 then 'blocked' else 'failure' end,
        jsonb_build_object(
          'target_account_id', target_account_id,
          'incorrect_attempts', next_attempts
        )
      );
    end if;
    return query select 'invalid'::text, null::uuid, null::uuid;
    return;
  end if;

  if target_grant.state = 'blocked' then
    return query select 'blocked'::text, null::uuid, null::uuid;
    return;
  elsif target_grant.state = 'consumed' then
    return query select 'used'::text, null::uuid, null::uuid;
    return;
  elsif target_grant.state = 'claimed' then
    return query select 'in_progress'::text, null::uuid, null::uuid;
    return;
  elsif target_grant.state <> 'pending' then
    return query select 'invalid'::text, null::uuid, null::uuid;
    return;
  end if;

  if target_grant.expires_at <= clock_timestamp() then
    update kavach_private.account_grants
      set state = 'expired'
    where id = target_grant.id;
    update kavach_private.account_operations
      set state = 'failed', error_code = 'grant_expired',
          completed_at = clock_timestamp()
    where id = target_grant.operation_id and state = 'started';
    return query select 'expired'::text, null::uuid, null::uuid;
    return;
  end if;

  update kavach_private.account_grants
    set state = 'claimed', claimed_at = clock_timestamp()
  where id = target_grant.id;

  return query
    select 'claimed'::text, target_auth_user_id, target_grant.operation_id;
end;
$$;

create function public.server_finish_setup_redemption(
  p_operation_id uuid,
  p_outcome text,
  p_error_code text default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_grant kavach_private.account_grants%rowtype;
  target_community_id uuid;
begin
  if p_outcome not in ('completed', 'failed', 'needs_reconciliation') then
    raise exception 'invalid setup outcome';
  end if;

  select setup_grant.* into target_grant
  from kavach_private.account_grants setup_grant
  where setup_grant.operation_id = p_operation_id
    and setup_grant.purpose = 'setup'
  for update;

  if target_grant.id is null or target_grant.state <> 'claimed' then
    return false;
  end if;

  select assignment.community_id into target_community_id
  from public.role_assignments assignment
  where assignment.account_link_id = target_grant.account_link_id
    and assignment.role = 'community_staff'
  limit 1;

  if p_outcome = 'completed' then
    update kavach_private.account_grants
      set state = 'consumed', consumed_at = clock_timestamp()
    where id = target_grant.id;
    update kavach_private.account_operations
      set state = 'completed', error_code = null,
          completed_at = clock_timestamp()
    where id = p_operation_id
      and operation_type = 'set_password'
      and state = 'started';
    if not found then
      raise exception 'setup operation unavailable';
    end if;
    insert into public.security_events (
      community_id, actor_account_id, event_type, outcome, details
    ) values (
      target_community_id, null,
      'staff_password_setup_completed', 'success',
      jsonb_build_object(
        'target_account_id', target_grant.account_link_id,
        'operation_id', p_operation_id
      )
    );
  else
    update kavach_private.account_grants
      set state = 'revoked', revoked_at = clock_timestamp()
    where id = target_grant.id;
    update kavach_private.account_operations
      set state = p_outcome,
          error_code = left(coalesce(p_error_code, 'auth_update_failed'), 80),
          completed_at = case when p_outcome = 'failed' then clock_timestamp() else null end
    where id = p_operation_id and operation_type = 'set_password';
    insert into public.security_events (
      community_id, actor_account_id, event_type, outcome, details
    ) values (
      target_community_id, null,
      'staff_password_setup_failed', 'failure',
      jsonb_build_object(
        'target_account_id', target_grant.account_link_id,
        'requires_reconciliation', p_outcome = 'needs_reconciliation'
      )
    );
  end if;
  return true;
end;
$$;

create function public.server_staff_setup_grant_status(p_account_link_id uuid)
returns table (state text, incorrect_attempts smallint, digest_present boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select setup_grant.state, setup_grant.incorrect_attempts,
         setup_grant.code_digest is not null
  from kavach_private.account_grants setup_grant
  where setup_grant.account_link_id = p_account_link_id
    and setup_grant.purpose = 'setup'
  order by setup_grant.created_at desc
  limit 1
$$;

create or replace function public.server_acknowledge_sign_in(p_auth_user_id uuid)
returns table (account_link_id uuid, activated boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_account public.account_links%rowtype;
  target_community uuid;
  was_activated boolean := false;
begin
  select * into target_account
  from public.account_links
  where auth_user_id = p_auth_user_id
  for update;

  if target_account.id is null or target_account.status = 'disabled' then
    return;
  end if;

  if target_account.account_kind = 'resident' then
    select membership.community_id into target_community
    from public.memberships membership
    where membership.resident_id = target_account.resident_id
      and membership.status = 'active'
      and exists (
        select 1 from public.verification_records verification
        where verification.membership_id = membership.id and verification.valid
      )
      and exists (
        select 1 from public.consent_records consent
        where consent.membership_id = membership.id
          and consent.consent_type = 'enrollment'
          and consent.granted
          and consent.withdrawn_at is null
      )
      and exists (
        select 1 from public.role_assignments assignment
        where assignment.account_link_id = target_account.id
          and assignment.community_id = membership.community_id
          and assignment.role = 'resident'
          and assignment.active
      )
    limit 1;
    if target_community is null then return; end if;
  elsif target_account.account_kind = 'staff' then
    select assignment.community_id into target_community
    from public.role_assignments assignment
    join public.communities community
      on community.id = assignment.community_id and community.active
    where assignment.account_link_id = target_account.id
      and assignment.role = 'community_staff'
      and assignment.active
    limit 1;
    if target_community is null then return; end if;
  elsif not exists (
    select 1 from public.role_assignments assignment
    where assignment.account_link_id = target_account.id and assignment.active
  ) then
    return;
  end if;

  if target_account.status = 'pending' and not exists (
    select 1 from kavach_private.account_grants setup_grant
    where setup_grant.account_link_id = target_account.id
      and setup_grant.purpose = 'setup'
      and setup_grant.state = 'consumed'
  ) then
    return;
  end if;

  if target_account.status = 'pending' then
    update public.account_links
      set status = 'active', activated_at = clock_timestamp()
      where id = target_account.id;
    was_activated := true;
  end if;

  insert into public.security_events (
    community_id, actor_account_id, target_resident_id,
    event_type, outcome, details
  ) values (
    target_community, target_account.id, target_account.resident_id,
    'authenticated_sign_in_acknowledged', 'success', '{}'::jsonb
  );

  return query select target_account.id, was_activated;
end;
$$;

revoke all on function public.server_create_staff_setup(
  uuid, uuid, uuid, uuid, text, text, text, uuid, bytea, timestamptz, uuid
) from public, anon, authenticated;
revoke all on function public.server_regenerate_staff_setup(
  uuid, uuid, uuid, bytea, timestamptz, uuid
) from public, anon, authenticated;
revoke all on function public.server_begin_setup_redemption(text, bytea)
  from public, anon, authenticated;
revoke all on function public.server_finish_setup_redemption(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.server_staff_setup_grant_status(uuid)
  from public, anon, authenticated;

grant execute on function public.server_create_staff_setup(
  uuid, uuid, uuid, uuid, text, text, text, uuid, bytea, timestamptz, uuid
) to service_role;
grant execute on function public.server_regenerate_staff_setup(
  uuid, uuid, uuid, bytea, timestamptz, uuid
) to service_role;
grant execute on function public.server_begin_setup_redemption(text, bytea)
  to service_role;
grant execute on function public.server_finish_setup_redemption(uuid, text, text)
  to service_role;
grant execute on function public.server_staff_setup_grant_status(uuid)
  to service_role;

commit;
