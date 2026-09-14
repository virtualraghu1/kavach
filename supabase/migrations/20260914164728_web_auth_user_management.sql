begin;

alter table public.account_links
  add column display_name text
  check (
    display_name is null
    or char_length(trim(display_name)) between 2 and 160
  );

create or replace function kavach_private.has_role(
  target_community uuid,
  allowed_roles text[]
)
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
      and (
        assignment.role = 'owner'
        or (
          assignment.community_id = target_community
          and exists (
            select 1
            from public.communities community
            where community.id = assignment.community_id
              and community.active
          )
        )
      )
  )
$$;

drop policy account_links_select_authorized on public.account_links;
create policy account_links_select_authorized on public.account_links
for select to authenticated
using (
  id = kavach_private.current_account_id()
  or kavach_private.has_role(null, array['owner'])
  or exists (
    select 1
    from public.residents resident
    where resident.id = account_links.resident_id
      and kavach_private.has_role(
        resident.community_id,
        array['community_staff']
      )
  )
);

create function public.server_validate_session(
  p_auth_user_id uuid,
  p_session_id uuid
)
returns table (
  account_link_id uuid,
  account_kind text,
  account_status text,
  display_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    account.id,
    account.account_kind,
    account.status,
    account.display_name
  from public.account_links account
  join auth.sessions session_record
    on session_record.id = p_session_id
   and session_record.user_id = account.auth_user_id
  where account.auth_user_id = p_auth_user_id
    and account.status = 'active'
    and (
      account.revoked_before is null
      or session_record.created_at > account.revoked_before
    )
  limit 1
$$;

create function public.server_account_usernames(p_account_ids uuid[])
returns table (account_link_id uuid, username text)
language sql
stable
security definer
set search_path = ''
as $$
  select login.account_link_id, login.identifier::text
  from kavach_private.login_identifiers login
  where login.account_link_id = any(p_account_ids)
    and login.identifier_type = 'username'
    and login.verified
$$;

revoke all on function public.server_validate_session(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.server_account_usernames(uuid[])
  from public, anon, authenticated;

grant execute on function public.server_validate_session(uuid, uuid)
  to service_role;
grant execute on function public.server_account_usernames(uuid[])
  to service_role;

commit;
