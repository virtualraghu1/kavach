-- A QR grants only the ability to ask for an existing resident account.
-- It never grants a role, password, or sign-in session. Only account-api's
-- service role may read or change these rows.
create table public.resident_qr_invites (
  id uuid primary key default gen_random_uuid(),
  resident_id uuid not null references public.residents(id) on delete cascade,
  token_digest text not null unique check (token_digest ~ '^[0-9a-f]{64}$'),
  state text not null default 'active' check (state in ('active', 'claimed', 'revoked')),
  created_by uuid not null references public.account_links(id),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  constraint resident_qr_invite_expiry check (expires_at > created_at)
);

create unique index resident_qr_one_active_invite
  on public.resident_qr_invites(resident_id) where state = 'active';

create table public.resident_qr_requests (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null unique references public.resident_qr_invites(id),
  resident_id uuid not null references public.residents(id) on delete cascade,
  requested_username text not null check (requested_username ~ '^[a-z][a-z0-9._-]{3,31}$'),
  state text not null default 'pending' check (state in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default clock_timestamp(),
  reviewed_by uuid references public.account_links(id),
  reviewed_at timestamptz
);

create unique index resident_qr_one_pending_request
  on public.resident_qr_requests(resident_id) where state = 'pending';
create index resident_qr_request_state_time
  on public.resident_qr_requests(state, requested_at desc);

alter table public.resident_qr_invites enable row level security;
alter table public.resident_qr_requests enable row level security;

revoke all on public.resident_qr_invites from public, anon, authenticated;
revoke all on public.resident_qr_requests from public, anon, authenticated;
grant select, insert, update on public.resident_qr_invites to service_role;
grant select, insert, update on public.resident_qr_requests to service_role;

-- Issue/revoke and claim/consume are single transactions so a reused QR or a
-- concurrent regeneration cannot leave an extra valid request behind.
create function public.server_issue_resident_qr(p_resident_id uuid, p_actor uuid, p_digest text, p_expires_at timestamptz)
returns void language plpgsql security invoker set search_path = '' as $$
declare target public.residents%rowtype;
begin
  select * into target from public.residents where id=p_resident_id for update;
  if target.id is null or target.membership_state <> 'active' or not exists (
    select 1 from public.account_links a join public.role_assignments r on r.account_link_id=a.id
    join public.communities c on c.id=target.community_id and c.active
    where a.id=p_actor and a.status='active' and r.active
    and (r.role='owner' or (r.role='community_staff' and r.community_id=target.community_id)))
  then raise exception 'office authorization required' using errcode='42501'; end if;
  if p_digest is null or p_digest !~ '^[0-9a-f]{64}$' or p_expires_at is null
    or p_expires_at <= clock_timestamp() or p_expires_at > clock_timestamp()+interval '7 days'
    or exists(select 1 from public.account_links where resident_id=p_resident_id)
    or exists(select 1 from public.resident_qr_requests where resident_id=p_resident_id and state='pending')
  then raise exception 'resident already has account or request, or invalid QR'; end if;
  update public.resident_qr_invites set state='revoked' where resident_id=p_resident_id and state='active';
  insert into public.resident_qr_invites(resident_id,token_digest,created_by,expires_at)
    values(p_resident_id,p_digest,p_actor,p_expires_at);
end $$;

create function public.server_request_resident_qr(p_digest text, p_username text)
returns void language plpgsql security invoker set search_path = '' as $$
declare target public.resident_qr_invites%rowtype; resident public.residents%rowtype;
begin
  select * into target from public.resident_qr_invites where token_digest=p_digest;
  if target.id is null then raise exception 'QR unavailable'; end if;
  select * into resident from public.residents where id=target.resident_id for update;
  select * into target from public.resident_qr_invites where id=target.id for update;
  if target.state <> 'active' or target.expires_at <= clock_timestamp()
    or resident.membership_state <> 'active'
    or not exists(select 1 from public.communities where id=resident.community_id and active)
    or not exists(select 1 from public.memberships where resident_id=resident.id and status='active')
    or exists(select 1 from public.account_links where resident_id=resident.id)
    or p_username is null or p_username !~ '^[a-z][a-z0-9._-]{3,31}$'
  then raise exception 'QR unavailable'; end if;
  insert into public.resident_qr_requests(invite_id,resident_id,requested_username)
    values(target.id,resident.id,p_username);
  update public.resident_qr_invites set state='claimed',claimed_at=clock_timestamp() where id=target.id;
end $$;

-- The existing setup function rechecks staff access, membership, recorded
-- consent and identity verification. Approval and setup commit together.
create function public.server_approve_resident_qr(
  p_request_id uuid, p_provision_operation_id uuid, p_password_operation_id uuid,
  p_grant_id uuid, p_auth_user_id uuid, p_auth_email text, p_username text,
  p_resident_id uuid, p_code_digest bytea, p_expires_at timestamptz, p_created_by uuid
) returns table(account_link_id uuid, grant_id uuid, expires_at timestamptz)
language plpgsql security invoker set search_path = '' as $$
declare target public.resident_qr_requests%rowtype; created record;
begin
  select * into target from public.resident_qr_requests where id=p_request_id for update;
  if target.id is null or target.state <> 'pending' or target.resident_id <> p_resident_id
    or target.requested_username <> p_username then raise exception 'request no longer pending'; end if;
  select * into created from public.server_create_resident_setup(
    p_provision_operation_id,p_password_operation_id,p_grant_id,p_auth_user_id,p_auth_email,
    p_username,p_resident_id,p_code_digest,p_expires_at,p_created_by);
  update public.resident_qr_requests set state='approved',reviewed_by=p_created_by,reviewed_at=clock_timestamp()
    where id=p_request_id;
  return query select created.account_link_id::uuid,created.grant_id::uuid,created.expires_at::timestamptz;
end $$;

revoke all on function public.server_issue_resident_qr(uuid,uuid,text,timestamptz) from public,anon,authenticated;
revoke all on function public.server_request_resident_qr(text,text) from public,anon,authenticated;
revoke all on function public.server_approve_resident_qr(uuid,uuid,uuid,uuid,uuid,text,text,uuid,bytea,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.server_issue_resident_qr(uuid,uuid,text,timestamptz) to service_role;
grant execute on function public.server_request_resident_qr(text,text) to service_role;
grant execute on function public.server_approve_resident_qr(uuid,uuid,uuid,uuid,uuid,text,text,uuid,bytea,timestamptz,uuid) to service_role;
