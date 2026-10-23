-- 寶寶奶量紀錄：Supabase 資料表與權限
-- 在 Supabase 專案的 SQL Editor 整段貼上執行一次即可。

create extension if not exists pgcrypto with schema extensions;

-- 家庭：同一個家庭的成員共用所有紀錄
create table if not exists public.families (
  id uuid primary key default gen_random_uuid(),
  baby_name text not null default '寶寶',
  baby_birthday date,
  daily_goal_ml int not null default 600,
  invite_code text not null unique default upper(substr(encode(extensions.gen_random_bytes(4), 'hex'), 1, 6)),
  created_at timestamptz not null default now()
);

-- 成員：每個帳號屬於一個家庭
create table if not exists public.family_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  display_name text not null default '家人',
  joined_at timestamptz not null default now()
);

-- 餵奶紀錄
create table if not exists public.feedings (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  fed_at timestamptz not null default now(),
  kind text not null check (kind in ('formula', 'bottle_breast', 'breast')),
  amount_ml int check (amount_ml is null or (amount_ml >= 0 and amount_ml <= 1000)),
  left_min int check (left_min is null or (left_min >= 0 and left_min <= 180)),
  right_min int check (right_min is null or (right_min >= 0 and right_min <= 180)),
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists feedings_family_time on public.feedings (family_id, fed_at desc);
create index if not exists family_members_family on public.family_members (family_id);
create index if not exists feedings_created_by on public.feedings (created_by);

-- 目前登入者的家庭 id（security definer 避免 RLS 遞迴）
create or replace function public.my_family_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select family_id from public.family_members where user_id = auth.uid()
$$;

-- 建立新家庭並把自己加入
create or replace function public.create_family(p_baby_name text, p_display_name text)
returns public.families
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.families;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if exists (select 1 from public.family_members where user_id = auth.uid()) then
    raise exception 'already in a family';
  end if;
  insert into public.families (baby_name) values (coalesce(nullif(trim(p_baby_name), ''), '寶寶'))
    returning * into f;
  insert into public.family_members (user_id, family_id, display_name)
    values (auth.uid(), f.id, coalesce(nullif(trim(p_display_name), ''), '家人'));
  return f;
end;
$$;

-- 用邀請碼加入家庭
create or replace function public.join_family(p_code text, p_display_name text)
returns public.families
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.families;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  select * into f from public.families where invite_code = upper(trim(p_code));
  if f.id is null then
    raise exception 'invalid invite code';
  end if;
  insert into public.family_members (user_id, family_id, display_name)
    values (auth.uid(), f.id, coalesce(nullif(trim(p_display_name), ''), '家人'))
    on conflict (user_id) do update set family_id = excluded.family_id, display_name = excluded.display_name;
  return f;
end;
$$;

-- 離開家庭
create or replace function public.leave_family()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.family_members where user_id = auth.uid()
$$;

revoke execute on function public.my_family_id(), public.create_family(text, text), public.join_family(text, text), public.leave_family() from public, anon;
grant execute on function public.my_family_id() to authenticated;
grant execute on function public.create_family(text, text) to authenticated;
grant execute on function public.join_family(text, text) to authenticated;
grant execute on function public.leave_family() to authenticated;

-- 自動更新 updated_at
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists feedings_touch on public.feedings;
create trigger feedings_touch before update on public.feedings
  for each row execute function public.touch_updated_at();

-- Row Level Security：只能看到、修改自己家庭的資料
alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.feedings enable row level security;

drop policy if exists "family read" on public.families;
create policy "family read" on public.families
  for select to authenticated using (id = public.my_family_id());

drop policy if exists "family update" on public.families;
create policy "family update" on public.families
  for update to authenticated using (id = public.my_family_id()) with check (id = public.my_family_id());

drop policy if exists "members read" on public.family_members;
create policy "members read" on public.family_members
  for select to authenticated using (family_id = public.my_family_id());

drop policy if exists "members update self" on public.family_members;
create policy "members update self" on public.family_members
  for update to authenticated using (user_id = auth.uid()) with check (family_id = public.my_family_id());

drop policy if exists "feedings read" on public.feedings;
create policy "feedings read" on public.feedings
  for select to authenticated using (family_id = public.my_family_id());

drop policy if exists "feedings insert" on public.feedings;
create policy "feedings insert" on public.feedings
  for insert to authenticated with check (family_id = public.my_family_id());

drop policy if exists "feedings update" on public.feedings;
create policy "feedings update" on public.feedings
  for update to authenticated using (family_id = public.my_family_id()) with check (family_id = public.my_family_id());

drop policy if exists "feedings delete" on public.feedings;
create policy "feedings delete" on public.feedings
  for delete to authenticated using (family_id = public.my_family_id());

-- 即時同步：讓其他手機馬上看到新紀錄
do $$
begin
  alter publication supabase_realtime add table public.feedings;
exception when duplicate_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.families;
exception when duplicate_object then null;
end;
$$;

-- 寶寶頭像：小男生／小女生，或上傳照片（存在私有的 avatars bucket，只有同家庭看得到）
alter table public.families
  add column if not exists baby_gender text not null default 'boy' check (baby_gender in ('boy', 'girl')),
  add column if not exists avatar_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "avatars family read" on storage.objects;
create policy "avatars family read" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select public.my_family_id())::text);
drop policy if exists "avatars family insert" on storage.objects;
create policy "avatars family insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select public.my_family_id())::text);
drop policy if exists "avatars family update" on storage.objects;
create policy "avatars family update" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select public.my_family_id())::text);
drop policy if exists "avatars family delete" on storage.objects;
create policy "avatars family delete" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select public.my_family_id())::text);

-- 成長紀錄：體重（對照 WHO 兒童生長標準）
create table if not exists public.growth (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  measured_on date not null default current_date,
  weight_kg numeric(5,3) not null check (weight_kg > 0 and weight_kg < 40),
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists growth_family_date on public.growth (family_id, measured_on);
create index if not exists growth_created_by on public.growth (created_by);
alter table public.growth enable row level security;
drop policy if exists "growth read" on public.growth;
create policy "growth read" on public.growth for select to authenticated using (family_id = (select public.my_family_id()));
drop policy if exists "growth insert" on public.growth;
create policy "growth insert" on public.growth for insert to authenticated with check (family_id = (select public.my_family_id()));
drop policy if exists "growth update" on public.growth;
create policy "growth update" on public.growth for update to authenticated using (family_id = (select public.my_family_id())) with check (family_id = (select public.my_family_id()));
drop policy if exists "growth delete" on public.growth;
create policy "growth delete" on public.growth for delete to authenticated using (family_id = (select public.my_family_id()));

do $$
begin
  alter publication supabase_realtime add table public.growth;
exception when duplicate_object then null;
end;
$$;

-- 尿布紀錄：尿尿／大便／都有，大便顏色參考兒童健康手冊的嬰兒大便辨識卡
create table if not exists public.diapers (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  changed_at timestamptz not null default now(),
  kind text not null check (kind in ('pee', 'poop', 'both')),
  poop_color text check (poop_color is null or poop_color in ('yellow', 'golden', 'green', 'brown', 'pale', 'red', 'black')),
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists diapers_family_time on public.diapers (family_id, changed_at desc);
create index if not exists diapers_created_by on public.diapers (created_by);
alter table public.diapers enable row level security;
drop policy if exists "diapers read" on public.diapers;
create policy "diapers read" on public.diapers for select to authenticated using (family_id = (select public.my_family_id()));
drop policy if exists "diapers insert" on public.diapers;
create policy "diapers insert" on public.diapers for insert to authenticated with check (family_id = (select public.my_family_id()));
drop policy if exists "diapers update" on public.diapers;
create policy "diapers update" on public.diapers for update to authenticated using (family_id = (select public.my_family_id())) with check (family_id = (select public.my_family_id()));
drop policy if exists "diapers delete" on public.diapers;
create policy "diapers delete" on public.diapers for delete to authenticated using (family_id = (select public.my_family_id()));

do $$
begin
  alter publication supabase_realtime add table public.diapers;
exception when duplicate_object then null;
end;
$$;
