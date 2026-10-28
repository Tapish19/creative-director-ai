import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

export const OWNER = "10000000-0000-4000-8000-000000000001";
export const OTHER = "10000000-0000-4000-8000-000000000002";

export async function testDatabase() {
  const db = new PGlite();
  // Only Supabase-owned auth/storage scaffolding is substituted. Application migrations,
  // RLS and PL/pgSQL execute unchanged in a real embedded PostgreSQL engine.
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create schema storage;
    grant usage on schema public, auth, storage to anon, authenticated, service_role;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant select on storage.objects to authenticated;
    create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1, '/') $$;
    insert into auth.users(id, email) values ('${OWNER}', 'one@example.test'), ('${OTHER}', 'two@example.test');
  `);
  const path = resolve("supabase/migrations");
  for (const file of (await readdir(path)).filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec(await readFile(resolve(path, file), "utf8"));
  }
  return db;
}

export async function authenticated<T>(
  db: PGlite,
  user: string,
  query: string,
  parameters: unknown[] = [],
) {
  return db.transaction(async (tx) => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
    return tx.query<T>(query, parameters);
  });
}

export async function service<T>(db: PGlite, query: string, parameters: unknown[] = []) {
  return db.transaction(async (tx) => {
    await tx.exec("set local role service_role");
    return tx.query<T>(query, parameters);
  });
}
