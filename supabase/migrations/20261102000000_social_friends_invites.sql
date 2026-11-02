-- Social profiles, friend requests, and private campaign invitations.
-- Run this migration in the Supabase SQL Editor before using the Amis screen.

create table if not exists public.social_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  public_id text not null unique default (
    'Y11-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
  ),
  username text not null,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.social_profiles alter column public_id set default (
  'Y11-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
);

create table if not exists public.social_friendships (
  user_low uuid not null references public.social_profiles(user_id) on delete cascade,
  user_high uuid not null references public.social_profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_low, user_high),
  check (user_low < user_high)
);

create table if not exists public.social_friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.social_profiles(user_id) on delete cascade,
  recipient_id uuid not null references public.social_profiles(user_id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (sender_id <> recipient_id)
);

create unique index if not exists social_friend_requests_pending_unique
  on public.social_friend_requests(sender_id, recipient_id) where status = 'pending';

create table if not exists public.social_game_invitations (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.social_profiles(user_id) on delete cascade,
  recipient_id uuid not null references public.social_profiles(user_id) on delete cascade,
  game_id text not null,
  campaign_name text not null,
  host_url text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  check (sender_id <> recipient_id),
  check (host_url ~ '^https://[a-zA-Z0-9-]+\.trycloudflare\.com/?$')
);

create index if not exists social_game_invitations_recipient_created
  on public.social_game_invitations(recipient_id, created_at desc);

alter table public.social_profiles enable row level security;
alter table public.social_friendships enable row level security;
alter table public.social_friend_requests enable row level security;
alter table public.social_game_invitations enable row level security;

drop policy if exists social_profiles_read_related on public.social_profiles;
create policy social_profiles_read_related on public.social_profiles for select to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.social_friendships f
    where (f.user_low = (select auth.uid()) and f.user_high = social_profiles.user_id)
       or (f.user_high = (select auth.uid()) and f.user_low = social_profiles.user_id)
  )
  or exists (
    select 1 from public.social_friend_requests r
    where r.status = 'pending'
      and ((r.sender_id = (select auth.uid()) and r.recipient_id = social_profiles.user_id)
        or (r.recipient_id = (select auth.uid()) and r.sender_id = social_profiles.user_id))
  )
);

drop policy if exists social_friendships_read_self on public.social_friendships;
create policy social_friendships_read_self on public.social_friendships for select to authenticated
using ((select auth.uid()) in (user_low, user_high));

drop policy if exists social_friend_requests_read_related on public.social_friend_requests;
create policy social_friend_requests_read_related on public.social_friend_requests for select to authenticated
using ((select auth.uid()) in (sender_id, recipient_id));

drop policy if exists social_game_invitations_read_related on public.social_game_invitations;
create policy social_game_invitations_read_related on public.social_game_invitations for select to authenticated
using ((select auth.uid()) in (sender_id, recipient_id));

create or replace function public.create_social_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text;
  v_display_name text;
begin
  v_username := coalesce(nullif(btrim(new.raw_user_meta_data ->> 'username'), ''), split_part(new.email, '@', 1), 'joueur');
  v_display_name := coalesce(nullif(btrim(new.raw_user_meta_data ->> 'displayName'), ''), nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), v_username);
  insert into public.social_profiles(user_id, username, display_name)
  values (new.id, left(v_username, 24), left(v_display_name, 40))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists create_social_profile_after_signup on auth.users;
create trigger create_social_profile_after_signup
  after insert on auth.users
  for each row execute function public.create_social_profile_for_auth_user();

create or replace function public.sync_my_social_profile(p_username text, p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_username text := left(btrim(coalesce(p_username, '')), 24);
  v_display_name text := left(btrim(coalesce(p_display_name, '')), 40);
  v_profile public.social_profiles%rowtype;
begin
  if v_user_id is null then raise exception 'Authentification requise.'; end if;
  if v_username !~ '^[a-zA-Z0-9._-]{2,24}$' then raise exception 'Pseudo invalide.'; end if;
  if length(v_display_name) < 2 then raise exception 'Pseudo affiché invalide.'; end if;
  insert into public.social_profiles(user_id, username, display_name)
  values (v_user_id, v_username, v_display_name)
  on conflict (user_id) do update set username = excluded.username, display_name = excluded.display_name, updated_at = now()
  returning * into v_profile;
  return jsonb_build_object('user_id', v_profile.user_id, 'public_id', v_profile.public_id,
    'username', v_profile.username, 'display_name', v_profile.display_name);
end;
$$;

create or replace function public.find_social_profile(p_public_id text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('user_id', p.user_id, 'public_id', p.public_id,
    'username', p.username, 'display_name', p.display_name)
  from public.social_profiles p
  where auth.uid() is not null and p.user_id <> auth.uid()
    and upper(p.public_id) = upper(btrim(coalesce(p_public_id, '')))
  limit 1;
$$;

create or replace function public.send_social_friend_request(p_recipient_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender_id uuid := auth.uid();
  v_request_id uuid;
  v_low uuid;
  v_high uuid;
begin
  if v_sender_id is null then raise exception 'Authentification requise.'; end if;
  if p_recipient_id is null or p_recipient_id = v_sender_id then raise exception 'Code joueur invalide.'; end if;
  if not exists (select 1 from public.social_profiles where user_id = p_recipient_id) then raise exception 'Joueur introuvable.'; end if;
  v_low := least(v_sender_id, p_recipient_id);
  v_high := greatest(v_sender_id, p_recipient_id);
  if exists (select 1 from public.social_friendships where user_low = v_low and user_high = v_high) then
    raise exception 'Vous êtes déjà amis.';
  end if;
  select id into v_request_id from public.social_friend_requests
    where sender_id = p_recipient_id and recipient_id = v_sender_id and status = 'pending' for update;
  if v_request_id is not null then
    update public.social_friend_requests set status = 'accepted', responded_at = now() where id = v_request_id;
    insert into public.social_friendships(user_low, user_high) values (v_low, v_high) on conflict do nothing;
    return v_request_id;
  end if;
  select id into v_request_id from public.social_friend_requests
    where sender_id = v_sender_id and recipient_id = p_recipient_id and status = 'pending' limit 1;
  if v_request_id is not null then return v_request_id; end if;
  insert into public.social_friend_requests(sender_id, recipient_id)
    values (v_sender_id, p_recipient_id) returning id into v_request_id;
  return v_request_id;
end;
$$;

create or replace function public.respond_social_friend_request(p_request_id uuid, p_accept boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.social_friend_requests%rowtype;
  v_low uuid;
  v_high uuid;
begin
  select * into v_request from public.social_friend_requests
    where id = p_request_id and recipient_id = auth.uid() and status = 'pending' for update;
  if not found then raise exception 'Cette demande n’est plus disponible.'; end if;
  update public.social_friend_requests set status = case when p_accept then 'accepted' else 'declined' end,
    responded_at = now() where id = p_request_id;
  if p_accept then
    v_low := least(v_request.sender_id, v_request.recipient_id);
    v_high := greatest(v_request.sender_id, v_request.recipient_id);
    insert into public.social_friendships(user_low, user_high) values (v_low, v_high) on conflict do nothing;
  end if;
  return true;
end;
$$;

create or replace function public.send_social_game_invitation(
  p_recipient_id uuid, p_game_id text, p_campaign_name text, p_host_url text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender_id uuid := auth.uid();
  v_low uuid;
  v_high uuid;
  v_id uuid;
begin
  if v_sender_id is null then raise exception 'Authentification requise.'; end if;
  if p_recipient_id is null or p_recipient_id = v_sender_id then raise exception 'Ami invalide.'; end if;
  v_low := least(v_sender_id, p_recipient_id);
  v_high := greatest(v_sender_id, p_recipient_id);
  if not exists (select 1 from public.social_friendships where user_low = v_low and user_high = v_high) then
    raise exception 'Ajoute cette personne en ami avant de lui envoyer une invitation.';
  end if;
  if coalesce(p_game_id, '') !~ '^Y11-[A-Z0-9]{6,20}$' then raise exception 'ID de campagne invalide.'; end if;
  if length(btrim(coalesce(p_campaign_name, ''))) < 2 then raise exception 'Nom de campagne invalide.'; end if;
  if coalesce(p_host_url, '') !~ '^https://[a-zA-Z0-9-]+\.trycloudflare\.com/?$' then raise exception 'Le lien public du MJ est invalide.'; end if;
  insert into public.social_game_invitations(sender_id, recipient_id, game_id, campaign_name, host_url)
    values (v_sender_id, p_recipient_id, upper(p_game_id), left(btrim(p_campaign_name), 80), rtrim(p_host_url, '/'))
    returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.respond_social_game_invitation(p_invitation_id uuid, p_accept boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.social_game_invitations
    set status = case when p_accept then 'accepted' else 'declined' end
    where id = p_invitation_id and recipient_id = auth.uid() and status = 'pending' and expires_at > now();
  if not found then raise exception 'Cette invitation n’est plus disponible.'; end if;
  return true;
end;
$$;

drop function if exists public.claim_social_game_invitation(uuid, text);
create or replace function public.claim_social_game_invitation(p_invitation_id uuid, p_game_id text, p_host_url text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.social_game_invitations
    set status = 'accepted'
    where id = p_invitation_id and recipient_id = auth.uid()
      and upper(game_id) = upper(coalesce(p_game_id, ''))
      and host_url = rtrim(coalesce(p_host_url, ''), '/')
      and status in ('pending', 'accepted') and expires_at > now();
  return found;
end;
$$;

revoke all on function public.create_social_profile_for_auth_user() from public, anon, authenticated;
revoke all on function public.sync_my_social_profile(text, text) from public, anon;
revoke all on function public.find_social_profile(text) from public, anon;
revoke all on function public.send_social_friend_request(uuid) from public, anon;
revoke all on function public.respond_social_friend_request(uuid, boolean) from public, anon;
revoke all on function public.send_social_game_invitation(uuid, text, text, text) from public, anon;
revoke all on function public.respond_social_game_invitation(uuid, boolean) from public, anon;
revoke all on function public.claim_social_game_invitation(uuid, text, text) from public, anon;

grant execute on function public.sync_my_social_profile(text, text) to authenticated;
grant execute on function public.find_social_profile(text) to authenticated;
grant execute on function public.send_social_friend_request(uuid) to authenticated;
grant execute on function public.respond_social_friend_request(uuid, boolean) to authenticated;
grant execute on function public.send_social_game_invitation(uuid, text, text, text) to authenticated;
grant execute on function public.respond_social_game_invitation(uuid, boolean) to authenticated;
grant execute on function public.claim_social_game_invitation(uuid, text, text) to authenticated;

grant select on public.social_profiles, public.social_friendships,
  public.social_friend_requests, public.social_game_invitations to authenticated;

