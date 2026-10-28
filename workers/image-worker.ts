import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { CloudflareImageProvider } from "@/services/images/cloudflare";
import { SupabaseImageStorage } from "@/services/images/storage";
import { SupabaseImageJobStore } from "@/services/jobs/image-store";
import { processImageJob } from "@/services/jobs/image-pipeline";
import { readImageWorkerConfig } from "./config";

async function main() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const config = readImageWorkerConfig(process.env);
  const client = createClient<Database>(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          signal: AbortSignal.any([
            AbortSignal.timeout(30_000),
            ...(init?.signal ? [init.signal] : []),
          ]),
        }),
    },
  });
  const store = new SupabaseImageJobStore(client);
  const storage = new SupabaseImageStorage(client);
  const provider = new CloudflareImageProvider({
    accountId: config.CLOUDFLARE_ACCOUNT_ID,
    apiToken: config.CLOUDFLARE_API_TOKEN,
  });
  const workerId = randomUUID();
  const shutdown = new AbortController();
  process.once("SIGINT", () => shutdown.abort());
  process.once("SIGTERM", () => shutdown.abort());
  const once = process.argv.includes("--once");
  console.info(`Image worker started (${provider.model}). Waiting for scene jobs.`);
  while (!shutdown.signal.aborted) {
    try {
      const job = await store.claim(workerId);
      if (!job) {
        if (once) return;
        await sleep(2_000, undefined, { signal: shutdown.signal });
        continue;
      }
      const lease = new AbortController();
      const signal = AbortSignal.any([shutdown.signal, lease.signal]);
      let heartbeat: Promise<void> | null = null;
      const timer = setInterval(() => {
        if (heartbeat) return;
        heartbeat = store
          .heartbeat(job)
          .then((valid) => {
            if (!valid) lease.abort();
          })
          .catch(() => lease.abort())
          .finally(() => {
            heartbeat = null;
          });
      }, 20_000);
      try {
        const outcome = await processImageJob(store, provider, storage, job, signal);
        console.info(`Generation ${job.generation_id}, scene ${job.scene_id}: ${outcome}`);
      } finally {
        clearInterval(timer);
        await heartbeat;
      }
      if (once) return;
    } catch {
      if (shutdown.signal.aborted) return;
      console.error(
        "Image worker operation failed. Unfinished claims recover after their lease expires. Check migrations and connectivity.",
      );
      if (once) {
        process.exitCode = 1;
        return;
      }
      await sleep(2_000, undefined, { signal: shutdown.signal }).catch(() => undefined);
    }
  }
}
main().catch((error: unknown) => {
  console.error(
    error instanceof Error && error.message.startsWith("Worker configuration")
      ? error.message
      : "The image worker could not start.",
  );
  process.exitCode = 1;
});
