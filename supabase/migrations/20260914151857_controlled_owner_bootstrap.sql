begin;

alter table kavach_private.account_operations
  drop constraint account_operations_operation_type_check;

alter table kavach_private.account_operations
  add constraint account_operations_operation_type_check
  check (operation_type in (
    'bootstrap_owner',
    'create_auth_user',
    'set_password',
    'recover_password',
    'revoke_sessions',
    'acknowledge_sign_in'
  ));

create function public.server_bootstrap_first_owner(
  p_operation_id uuid,
  p_auth_user_id uuid,
  p_username text,
  p_verified_email text default null
)
returns table (account_link_id uuid, created boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  normalized_username text := lower(trim(p_username));
  normalized_email text := nullif(lower(trim(p_verified_email)), '');
  auth_email text;
  auth_email_confirmed_at timestamptz;
  existing_operation kavach_private.account_operations%rowtype;
  new_account_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('kavach:first-owner', 0));

  select * into existing_operation
  from kavach_private.account_operations operation
  where operation.id = p_operation_id;

  if existing_operation.id is not null then
    if existing_operation.operation_type <> 'bootstrap_owner'
      or existing_operation.external_auth_user_id <> p_auth_user_id
      or existing_operation.account_link_id is null
      or existing_operation.state <> 'completed' then
      raise exception 'bootstrap operation conflict';
    end if;
    return query select existing_operation.account_link_id, false;
    return;
  end if;

  if normalized_username !~ '^[a-z][a-z0-9._-]{3,31}$' then
    raise exception 'invalid owner username';
  end if;

  if exists (
    select 1 from public.role_assignments assignment
    where assignment.role = 'owner'
  ) then
    raise exception 'owner already bootstrapped';
  end if;

  if exists (
    select 1 from public.account_links account
    where account.auth_user_id = p_auth_user_id
  ) then
    raise exception 'auth user already linked';
  end if;

  select lower(auth_user.email), auth_user.email_confirmed_at
    into auth_email, auth_email_confirmed_at
  from auth.users auth_user
  where auth_user.id = p_auth_user_id;

  if auth_email is null then
    raise exception 'auth user not found or missing email identity';
  end if;

  if normalized_email is not null then
    if normalized_email <> auth_email
      or auth_email_confirmed_at is null
      or normalized_email like '%.invalid' then
      raise exception 'verified email does not match confirmed auth identity';
    end if;
  end if;

  insert into public.account_links (
    auth_user_id, account_kind, status, activated_at
  ) values (
    p_auth_user_id, 'owner', 'active', clock_timestamp()
  ) returning id into new_account_id;

  insert into kavach_private.login_identifiers (
    account_link_id, identifier, identifier_type, auth_email, verified
  ) values (
    new_account_id, normalized_username, 'username', auth_email, true
  );

  if normalized_email is not null then
    insert into kavach_private.login_identifiers (
      account_link_id, identifier, identifier_type, auth_email, verified
    ) values (
      new_account_id, normalized_email, 'verified_email', auth_email, true
    );
  end if;

  insert into public.role_assignments (
    account_link_id, community_id, role, active, granted_by
  ) values (
    new_account_id, null, 'owner', true, null
  );

  insert into kavach_private.account_operations (
    id, account_link_id, operation_type, state,
    external_auth_user_id, completed_at
  ) values (
    p_operation_id, new_account_id, 'bootstrap_owner', 'completed',
    p_auth_user_id, clock_timestamp()
  );

  insert into public.security_events (
    community_id, actor_account_id, target_resident_id,
    event_type, outcome, details
  ) values (
    null, new_account_id, null,
    'owner_bootstrapped_offline', 'success',
    jsonb_build_object('operation_id', p_operation_id)
  );

  return query select new_account_id, true;
end;
$$;

revoke all on function public.server_bootstrap_first_owner(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.server_bootstrap_first_owner(uuid, uuid, text, text)
  to service_role;

commit;
