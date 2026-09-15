begin;

create extension if not exists citext with schema extensions;

create schema if not exists kavach_private;
revoke all on schema kavach_private from public, anon, authenticated;
grant usage on schema kavach_private to authenticated;

create table public.communities (
  id uuid primary key default gen_random_uuid(),
  slug extensions.citext not null unique,
  display_name text not null check (char_length(trim(display_name)) between 3 and 160),
  office_contact_text text,
  timezone text not null default 'Asia/Kolkata' check (timezone = 'Asia/Kolkata'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.residents (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete restrict,
  full_name text not null check (char_length(trim(full_name)) between 2 and 160),
  house_number text not null check (char_length(trim(house_number)) between 1 and 40),
  block text,
  contact_phone text,
  personal_email extensions.citext,
  category text not null default 'community_member' check (category in ('senior', 'community_member')),
  preferred_language text,
  membership_state text not null default 'draft' check (membership_state in ('draft', 'active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, community_id)
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  resident_id uuid not null,
  community_id uuid not null references public.communities(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'active', 'inactive')),
  activated_at timestamptz,
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (resident_id, community_id),
  foreign key (resident_id, community_id)
    references public.residents(id, community_id) on delete restrict,
  check ((status = 'inactive') = (deactivated_at is not null))
);

create table public.account_links (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete restrict,
  resident_id uuid unique references public.residents(id) on delete restrict,
  account_kind text not null check (account_kind in ('owner', 'staff', 'resident')),
  status text not null default 'pending' check (status in ('pending', 'active', 'disabled')),
  activated_at timestamptz,
  revoked_before timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((account_kind = 'resident') = (resident_id is not null))
);

create table public.role_assignments (
  id uuid primary key default gen_random_uuid(),
  account_link_id uuid not null references public.account_links(id) on delete restrict,
  community_id uuid references public.communities(id) on delete restrict,
  role text not null check (role in ('owner', 'community_staff', 'resident')),
  active boolean not null default true,
  granted_by uuid references public.account_links(id) on delete restrict,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  check ((role = 'owner' and community_id is null) or (role <> 'owner' and community_id is not null)),
  check ((active and revoked_at is null) or (not active and revoked_at is not null))
);

create unique index role_assignments_scope_unique
  on public.role_assignments (
    account_link_id,
    coalesce(community_id, '00000000-0000-0000-0000-000000000000'::uuid),
    role
  ) where active;

create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  resident_id uuid not null references public.residents(id) on delete restrict,
  membership_id uuid not null references public.memberships(id) on delete restrict,
  consent_type text not null default 'enrollment' check (consent_type in ('enrollment', 'privacy')),
  granted boolean not null,
  recorded_by uuid not null references public.account_links(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  details jsonb not null default '{}'::jsonb,
  check (not granted or withdrawn_at is null)
);

create table public.verification_records (
  id uuid primary key default gen_random_uuid(),
  resident_id uuid not null references public.residents(id) on delete restrict,
  membership_id uuid not null references public.memberships(id) on delete restrict,
  method text not null check (method in ('in_person_government_id', 'in_person_colony_record', 'owner_override')),
  reason text not null check (char_length(trim(reason)) between 3 and 500),
  verified_by uuid not null references public.account_links(id) on delete restrict,
  verified_at timestamptz not null default now(),
  valid boolean not null default true,
  invalidated_at timestamptz,
  check ((valid and invalidated_at is null) or (not valid and invalidated_at is not null))
);

create table public.app_installations (
  id uuid primary key default gen_random_uuid(),
  account_link_id uuid not null references public.account_links(id) on delete cascade,
  platform text not null check (platform in ('ios', 'android', 'web')),
  installation_id_hash bytea not null,
  first_authenticated_at timestamptz,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (account_link_id, installation_id_hash)
);

create table public.security_events (
  id bigint generated always as identity primary key,
  community_id uuid references public.communities(id) on delete restrict,
  actor_account_id uuid references public.account_links(id) on delete set null,
  target_resident_id uuid references public.residents(id) on delete set null,
  event_type text not null check (char_length(event_type) between 3 and 80),
  outcome text not null check (outcome in ('success', 'failure', 'blocked')),
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create table kavach_private.login_identifiers (
  id uuid primary key default gen_random_uuid(),
  account_link_id uuid not null references public.account_links(id) on delete cascade,
  identifier extensions.citext not null unique,
  identifier_type text not null check (identifier_type in ('username', 'verified_email', 'internal_alias')),
  auth_email extensions.citext not null,
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (identifier_type <> 'username' or identifier::text ~ '^[a-z][a-z0-9._-]{3,31}$')
);

create unique index login_identifiers_verified_email_unique
  on kavach_private.login_identifiers (identifier)
  where identifier_type = 'verified_email' and verified;

create table kavach_private.account_grants (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  account_link_id uuid not null references public.account_links(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  purpose text not null check (purpose in ('setup', 'recovery')),
  code_digest bytea,
  token_digest bytea,
  state text not null default 'pending' check (state in ('pending', 'claimed', 'consumed', 'revoked', 'expired', 'blocked')),
  incorrect_attempts smallint not null default 0 check (incorrect_attempts between 0 and 5),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_by uuid not null references public.account_links(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (code_digest is not null or token_digest is not null),
  check (expires_at <= created_at + interval '10 minutes')
);

create unique index account_grants_one_active_per_purpose
  on kavach_private.account_grants (account_link_id, purpose)
  where state in ('pending', 'claimed');

create table kavach_private.account_operations (
  id uuid primary key,
  account_link_id uuid references public.account_links(id) on delete restrict,
  operation_type text not null check (operation_type in ('create_auth_user', 'set_password', 'recover_password', 'revoke_sessions', 'acknowledge_sign_in')),
  state text not null default 'started' check (state in ('started', 'auth_completed', 'completed', 'failed', 'needs_reconciliation')),
  external_auth_user_id uuid,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table kavach_private.rate_limit_buckets (
  bucket_key bytea not null,
  action text not null,
  window_started_at timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  blocked_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (bucket_key, action, window_started_at)
);

create index residents_community_idx on public.residents (community_id, membership_state);
create index memberships_community_status_idx on public.memberships (community_id, status);
create index account_links_resident_idx on public.account_links (resident_id) where resident_id is not null;
create index role_assignments_community_idx on public.role_assignments (community_id, role) where active;
create index verification_records_membership_idx on public.verification_records (membership_id, valid);
create index consent_records_membership_idx on public.consent_records (membership_id, consent_type, granted);
create index security_events_community_time_idx on public.security_events (community_id, occurred_at desc);
create index account_grants_expiry_idx on kavach_private.account_grants (expires_at) where state in ('pending', 'claimed');

create function kavach_private.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger communities_touch_updated_at before update on public.communities
for each row execute function kavach_private.touch_updated_at();
create trigger residents_touch_updated_at before update on public.residents
for each row execute function kavach_private.touch_updated_at();
create trigger memberships_touch_updated_at before update on public.memberships
for each row execute function kavach_private.touch_updated_at();
create trigger account_links_touch_updated_at before update on public.account_links
for each row execute function kavach_private.touch_updated_at();
create trigger login_identifiers_touch_updated_at before update on kavach_private.login_identifiers
for each row execute function kavach_private.touch_updated_at();
create trigger account_operations_touch_updated_at before update on kavach_private.account_operations
for each row execute function kavach_private.touch_updated_at();

create function kavach_private.current_account_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select account.id
  from public.account_links account
  where account.auth_user_id = (select auth.uid())
    and account.status = 'active'
    and (
      account.revoked_before is null
      or exists (
        select 1
        from auth.sessions session_record
        where session_record.id = nullif((select auth.jwt() ->> 'session_id'), '')::uuid
          and session_record.user_id = account.auth_user_id
          and session_record.created_at > account.revoked_before
      )
    )
  limit 1
$$;

create function kavach_private.has_role(target_community uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.role_assignments assignment
    where assignment.account_link_id = kavach_private.current_account_id()
      and assignment.active
      and assignment.role = any(allowed_roles)
      and (assignment.role = 'owner' or assignment.community_id = target_community)
  )
$$;

create function kavach_private.can_read_resident(target_resident uuid, target_community uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.account_links account
    where account.id = kavach_private.current_account_id()
      and account.resident_id = target_resident
  ) or kavach_private.has_role(target_community, array['owner', 'community_staff'])
$$;

create function kavach_private.revoke_membership_grants()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'active' then
    update kavach_private.account_grants
      set state = 'revoked', revoked_at = now()
      where membership_id = new.id and state in ('pending', 'claimed');
  end if;
  return new;
end;
$$;

create trigger memberships_revoke_grants
after update of status on public.memberships
for each row when (old.status is distinct from new.status)
execute function kavach_private.revoke_membership_grants();

create function kavach_private.revoke_invalid_verification_grants()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not new.valid then
    update kavach_private.account_grants
      set state = 'revoked', revoked_at = now()
      where membership_id = new.membership_id and state in ('pending', 'claimed');
  end if;
  return new;
end;
$$;

create trigger verification_revoke_grants
after update of valid on public.verification_records
for each row when (old.valid and not new.valid)
execute function kavach_private.revoke_invalid_verification_grants();

revoke all on public.communities, public.residents, public.memberships,
  public.account_links, public.role_assignments, public.consent_records,
  public.verification_records, public.app_installations, public.security_events
  from anon, authenticated;
grant select on public.communities, public.residents, public.memberships,
  public.account_links, public.role_assignments, public.consent_records,
  public.verification_records, public.app_installations, public.security_events
  to authenticated;

revoke all on all tables in schema kavach_private from public, anon, authenticated;
revoke all on all functions in schema kavach_private from public, anon;
grant execute on function kavach_private.current_account_id() to authenticated;
grant execute on function kavach_private.has_role(uuid, text[]) to authenticated;
grant execute on function kavach_private.can_read_resident(uuid, uuid) to authenticated;

alter table public.communities enable row level security;
alter table public.residents enable row level security;
alter table public.memberships enable row level security;
alter table public.account_links enable row level security;
alter table public.role_assignments enable row level security;
alter table public.consent_records enable row level security;
alter table public.verification_records enable row level security;
alter table public.app_installations enable row level security;
alter table public.security_events enable row level security;
alter table kavach_private.login_identifiers enable row level security;
alter table kavach_private.account_grants enable row level security;
alter table kavach_private.account_operations enable row level security;
alter table kavach_private.rate_limit_buckets enable row level security;

create policy communities_select_authorized on public.communities
for select to authenticated
using (
  kavach_private.has_role(id, array['owner', 'community_staff'])
  or exists (
    select 1 from public.memberships membership
    join public.account_links account on account.resident_id = membership.resident_id
    where account.id = kavach_private.current_account_id()
      and membership.community_id = communities.id
      and membership.status = 'active'
  )
);

create policy residents_select_authorized on public.residents
for select to authenticated
using (kavach_private.can_read_resident(id, community_id));

create policy memberships_select_authorized on public.memberships
for select to authenticated
using (kavach_private.can_read_resident(resident_id, community_id));

create policy account_links_select_authorized on public.account_links
for select to authenticated
using (
  id = kavach_private.current_account_id()
  or exists (
    select 1 from public.residents resident
    where resident.id = account_links.resident_id
      and kavach_private.has_role(resident.community_id, array['owner', 'community_staff'])
  )
);

create policy role_assignments_select_authorized on public.role_assignments
for select to authenticated
using (
  account_link_id = kavach_private.current_account_id()
  or kavach_private.has_role(community_id, array['owner'])
);

create policy consent_records_select_authorized on public.consent_records
for select to authenticated
using (
  exists (
    select 1 from public.memberships membership
    where membership.id = consent_records.membership_id
      and kavach_private.can_read_resident(membership.resident_id, membership.community_id)
  )
);

create policy verification_records_select_authorized on public.verification_records
for select to authenticated
using (
  exists (
    select 1 from public.memberships membership
    where membership.id = verification_records.membership_id
      and kavach_private.can_read_resident(membership.resident_id, membership.community_id)
  )
);

create policy app_installations_select_authorized on public.app_installations
for select to authenticated
using (
  account_link_id = kavach_private.current_account_id()
  or exists (
    select 1 from public.account_links account
    join public.residents resident on resident.id = account.resident_id
    where account.id = app_installations.account_link_id
      and kavach_private.has_role(resident.community_id, array['owner', 'community_staff'])
  )
);

create policy security_events_select_authorized on public.security_events
for select to authenticated
using (
  actor_account_id = kavach_private.current_account_id()
  or (
    target_resident_id is not null
    and kavach_private.can_read_resident(target_resident_id, community_id)
  )
  or kavach_private.has_role(community_id, array['owner', 'community_staff'])
);

insert into public.communities (id, slug, display_name, office_contact_text, timezone)
values (
  '00000000-0000-4000-8000-000000000001',
  'hig-bhel-township-hyderabad',
  'HIG, BHEL Township, Hyderabad',
  'Please visit the HIG community office for account help.',
  'Asia/Kolkata'
)
on conflict (id) do update
set display_name = excluded.display_name,
    office_contact_text = excluded.office_contact_text,
    timezone = excluded.timezone,
    updated_at = now();

commit;
