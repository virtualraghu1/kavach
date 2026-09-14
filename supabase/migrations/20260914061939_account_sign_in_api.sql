begin;

create function public.server_resolve_login(p_identifier text)
returns table (
  account_link_id uuid,
  auth_user_id uuid,
  auth_email text,
  account_kind text,
  account_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    account.id,
    account.auth_user_id,
    login.auth_email::text,
    account.account_kind,
    account.status
  from kavach_private.login_identifiers login
  join public.account_links account on account.id = login.account_link_id
  where login.identifier = lower(trim(p_identifier))::extensions.citext
    and login.identifier_type in ('username', 'verified_email')
    and (login.identifier_type = 'username' or login.verified)
  limit 1
$$;

create function public.server_consume_rate_limit(
  p_bucket_key bytea,
  p_action text,
  p_limit integer default 5,
  p_window_seconds integer default 900,
  p_block_seconds integer default 900
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  safe_limit integer := greatest(1, least(p_limit, 20));
  safe_window integer := greatest(60, least(p_window_seconds, 3600));
  safe_block integer := greatest(60, least(p_block_seconds, 86400));
  window_start timestamptz;
  current_attempts integer;
  current_blocked_until timestamptz;
begin
  if p_bucket_key is null or octet_length(p_bucket_key) < 16 then
    raise exception 'invalid rate-limit bucket';
  end if;
  if p_action !~ '^[a-z_]{3,40}$' then
    raise exception 'invalid rate-limit action';
  end if;

  window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / safe_window) * safe_window
  );

  insert into kavach_private.rate_limit_buckets (
    bucket_key, action, window_started_at, attempts, blocked_until, updated_at
  )
  values (p_bucket_key, p_action, window_start, 1, null, clock_timestamp())
  on conflict (bucket_key, action, window_started_at)
  do update set
    attempts = kavach_private.rate_limit_buckets.attempts + 1,
    blocked_until = case
      when kavach_private.rate_limit_buckets.blocked_until > clock_timestamp()
        then kavach_private.rate_limit_buckets.blocked_until
      when kavach_private.rate_limit_buckets.attempts + 1 > safe_limit
        then clock_timestamp() + make_interval(secs => safe_block)
      else null
    end,
    updated_at = clock_timestamp()
  returning attempts, blocked_until
  into current_attempts, current_blocked_until;

  return query select
    current_attempts <= safe_limit
      and (current_blocked_until is null or current_blocked_until <= clock_timestamp()),
    case
      when current_blocked_until > clock_timestamp()
        then greatest(1, ceil(extract(epoch from current_blocked_until - clock_timestamp()))::integer)
      else 0
    end;
end;
$$;

create function public.server_acknowledge_sign_in(p_auth_user_id uuid)
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

    if target_community is null then
      return;
    end if;
  elsif not exists (
    select 1 from public.role_assignments assignment
    where assignment.account_link_id = target_account.id and assignment.active
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

revoke all on function public.server_resolve_login(text) from public, anon, authenticated;
revoke all on function public.server_consume_rate_limit(bytea, text, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.server_acknowledge_sign_in(uuid) from public, anon, authenticated;

grant execute on function public.server_resolve_login(text) to service_role;
grant execute on function public.server_consume_rate_limit(bytea, text, integer, integer, integer) to service_role;
grant execute on function public.server_acknowledge_sign_in(uuid) to service_role;

commit;
