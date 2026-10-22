#!/usr/bin/env node
// Seed the store from ../board.json (export of the old artifact).
// File store: copies to BOARD_FILE. Postgres: applies db/schema.sql and upserts rows.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

loadEnv(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env.local'));
loadEnv(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env'));

const force = process.argv.includes('--force');
const srcArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const src = path.resolve(srcArg || '../board.json');
if (!existsSync(src)) { console.error(`No export at ${src}`); process.exit(1); }

if (process.env.DATABASE_URL) {
  await seedPostgres(process.env.DATABASE_URL, src, force);
} else {
  seedFile(src, force);
}

function seedFile(source, overwrite) {
  const dest = path.resolve(process.env.BOARD_FILE || './data/board.json');
  if (existsSync(dest) && !overwrite) { console.error(`${dest} exists; pass --force to overwrite.`); process.exit(1); }
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(source, dest);
  console.log(`Seeded ${dest} from ${source}`);
}

async function seedPostgres(url, source, overwrite) {
  const board = JSON.parse(readFileSync(source, 'utf8'));
  const schema = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../db/schema.sql'), 'utf8');
  const pool = new pg.Pool({
    connectionString: url,
    ssl: url.includes('neon.tech') || url.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
  });
  const client = await pool.connect();
  try {
    await client.query(schema);
    const count = await client.query('select count(*)::int as n from tickets');
    if (count.rows[0].n > 0 && !overwrite) {
      console.error(`Postgres already has ${count.rows[0].n} tickets; pass --force to overwrite.`);
      process.exit(1);
    }
    await client.query('begin');
    if (overwrite) {
      await client.query('truncate tickets, decisions, ticket_log, runs, runner_status');
    }
    for (const [id, t] of Object.entries(board.tickets || {})) {
      const body = { ...t, id, version: t.version ?? 1, runner: t.runner ?? 'claude' };
      await client.query(
        `insert into tickets (id, body, version, updated_at) values ($1, $2::jsonb, $3, to_timestamp(($4::bigint)/1000.0))
         on conflict (id) do update set body = excluded.body, version = excluded.version, updated_at = excluded.updated_at`,
        [id, JSON.stringify(body), body.version, t.updatedAt || Date.now()],
      );
    }
    for (const [id, d] of Object.entries(board.decisions || {})) {
      const body = { ...d, id, version: d.version ?? 1 };
      await client.query(
        `insert into decisions (id, body, version) values ($1, $2::jsonb, $3)
         on conflict (id) do update set body = excluded.body, version = excluded.version`,
        [id, JSON.stringify(body), body.version],
      );
    }
    for (const [id, doc] of Object.entries(board.log || {})) {
      await client.query(
        `insert into ticket_log (ticket_id, entries, version) values ($1, $2::jsonb, $3)
         on conflict (ticket_id) do update set entries = excluded.entries, version = excluded.version`,
        [id, JSON.stringify(doc.entries || []), doc.version ?? 1],
      );
    }
    await client.query('commit');
    console.log(`Seeded Postgres from ${source}: ${Object.keys(board.tickets || {}).length} tickets, ${Object.keys(board.decisions || {}).length} decisions`);
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || m[1] in process.env) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
