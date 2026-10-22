-- Postgres schema for the hosted board (Neon via Vercel Marketplace).
-- Bodies are JSONB with the same shape as lib/store/types.ts; `version` drives optimistic concurrency.
create table if not exists tickets (
  id text primary key,
  body jsonb not null,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);
create table if not exists decisions (
  id text primary key,
  body jsonb not null,
  version integer not null default 1
);
create table if not exists ticket_log (
  ticket_id text primary key,
  entries jsonb not null default '[]',
  version integer not null default 1
);
create table if not exists runs (
  id uuid primary key,
  ticket_id text not null,
  body jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists runs_ticket on runs (ticket_id, created_at desc);
create table if not exists runner_status (
  id smallint primary key default 1 check (id = 1),
  last_seen_at timestamptz not null,
  host text not null,
  busy_with text
);
