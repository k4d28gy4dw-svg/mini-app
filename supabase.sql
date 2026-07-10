-- Выполните этот файл в Supabase -> SQL Editor один раз.
create table if not exists public.checkers_rooms (
  id text primary key,
  state jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.checkers_rooms enable row level security;

drop policy if exists "rooms_read" on public.checkers_rooms;
create policy "rooms_read"
  on public.checkers_rooms for select
  to anon
  using (true);

drop policy if exists "rooms_create" on public.checkers_rooms;
create policy "rooms_create"
  on public.checkers_rooms for insert
  to anon
  with check (
    char_length(id) = 6
    and state ? 'whiteId'
    and state ? 'board'
  );

drop policy if exists "rooms_update" on public.checkers_rooms;
create policy "rooms_update"
  on public.checkers_rooms for update
  to anon
  using (true)
  with check (
    char_length(id) = 6
    and state ? 'whiteId'
    and state ? 'board'
  );

alter publication supabase_realtime add table public.checkers_rooms;
