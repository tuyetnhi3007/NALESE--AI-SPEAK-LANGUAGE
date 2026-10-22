-- ============================================================
-- supabase/schema.sql
-- NALESE Database Schema & RLS Policies
-- Chạy script này trong Supabase Dashboard -> SQL Editor
-- ============================================================

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table public.vocab_items (
  id uuid primary key default gen_random_uuid(),
  language text not null check (language in ('zh','ja','en')),
  position int not null,
  reading text not null default '',
  term text not null,
  meaning_vi text not null,
  created_at timestamptz not null default now(),
  unique (language, term, reading)
);
create index vocab_items_lang_pos_idx on public.vocab_items (language, position);

create table public.user_learned_words (
  user_id uuid not null references auth.users(id) on delete cascade,
  vocab_id uuid not null references public.vocab_items(id) on delete cascade,
  learned_at timestamptz not null default now(),
  primary key (user_id, vocab_id)
);

create table public.chat_messages (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  language text not null check (language in ('zh','ja','en')),
  role text not null check (role in ('user','assistant')),
  original text not null default '',
  romanization text not null default '',
  translation text not null default '',
  pronunciation jsonb,
  extra jsonb,
  created_at timestamptz not null default now()
);
create index chat_messages_user_lang_time_idx on public.chat_messages (user_id, language, created_at desc);

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)));
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
create policy profiles_select_own on public.profiles for select to authenticated using (auth.uid() = id);
create policy profiles_update_own on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

alter table public.vocab_items enable row level security;
create policy vocab_select_authenticated on public.vocab_items for select to authenticated using (true);

alter table public.user_learned_words enable row level security;
create policy learned_select_own on public.user_learned_words for select to authenticated using (auth.uid() = user_id);
create policy learned_insert_own on public.user_learned_words for insert to authenticated with check (auth.uid() = user_id);
create policy learned_delete_own on public.user_learned_words for delete to authenticated using (auth.uid() = user_id);

alter table public.chat_messages enable row level security;
create policy chat_select_own on public.chat_messages for select to authenticated using (auth.uid() = user_id);
create policy chat_insert_own on public.chat_messages for insert to authenticated with check (auth.uid() = user_id);
create policy chat_update_own on public.chat_messages for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy chat_delete_own on public.chat_messages for delete to authenticated using (auth.uid() = user_id);
