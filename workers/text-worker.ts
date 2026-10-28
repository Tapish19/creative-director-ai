import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { GeminiProvider } from "@/services/ai/gemini";
import { SupabaseTextJobStore } from "@/services/jobs/supabase-store";
import { processTextJob } from "@/services/jobs/text-pipeline";
import { readWorkerConfig } from "./config";

async function main() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const config = readWorkerConfig(process.env);
  const client = createClient<Database>(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          signal: AbortSignal.any([
            AbortSignal.timeout(10_000),
            ...(init?.signal ? [init.signal] : []),
          ]),
        }),
    },
  });
  const store = new SupabaseTextJobStore(client);
  const provider = new GeminiProvider({
    apiKey: config.GEMINI_API_KEY,
    model: config.GEMINI_MODEL,
  });
  const workerId = randomUUID();
  const shutdown = new AbortController();
  process.once("SIGINT", () => shutdown.abort());
  process.once("SIGTERM", () => shutdown.abort());
  const once = process.argv.includes("--once");
  console.info(`Text worker started (${provider.model}). Waiting for queued campaigns.`);

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
      let heartbeat = Promise.resolve();
      const timer = setInterval(() => {
        heartbeat = store
          .heartbeat(job)
          .then((valid) => {
            if (!valid) lease.abort();
          })
          .catch(() => lease.abort());
      }, 20_000);
      try {
        const outcome = await processTextJob(store, provider, job, signal);
        console.info(`Generation ${job.generation_id}: ${outcome}`);
      } finally {
        clearInterval(timer);
        await heartbeat;
      }
      if (once) return;
    } catch {
      if (shutdown.signal.aborted) return;
      console.error(
        "Worker operation failed. Unfinished claims will recover after their lease expires. Check database migrations and connectivity.",
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
  // Only our configuration error is safe to print; never log client or HTTP objects.
  console.error(
    error instanceof Error && error.message.startsWith("Worker configuration")
      ? error.message
      : "The text worker could not start.",
  );
  process.exitCode = 1;
});
