create table public.assets (
  id uuid primary key default gen_random_uuid(),
  path text not null unique,          -- e.g. "images/hero.png"
  filename text not null,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz default now()
);

-- optional: simple RLS so only the service role can write
alter table public.assets enable row level security;
create policy "Public read" on public.assets for select using (true);

# Also requires the CDN buckets `cdn-assets` on Supabase