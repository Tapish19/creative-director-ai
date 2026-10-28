import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createVoiceProvider } from "@/services/voice/factory";
import { SupabaseVoiceStorage } from "@/services/voice/storage";
import { SupabaseVoiceJobStore } from "@/services/jobs/voice-store";
import { processVoiceJob } from "@/services/jobs/voice-pipeline";
import { readVoiceWorkerConfig } from "./config";
import { VoiceError } from "@/services/voice/errors";

async function main() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const config = readVoiceWorkerConfig(process.env);
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
  const store = new SupabaseVoiceJobStore(client);
  const storage = new SupabaseVoiceStorage(client);
  const provider = createVoiceProvider(process.env);
  const workerId = randomUUID();
  const shutdown = new AbortController();
  process.once("SIGINT", () => shutdown.abort());
  process.once("SIGTERM", () => shutdown.abort());
  const once = process.argv.includes("--once");
  console.info(`Voice worker started (${provider.model}). Waiting for narration jobs.`);
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
        const outcome = await processVoiceJob(store, provider, storage, job, signal);
        console.info(`Generation ${job.generation_id}: ${outcome}`);
      } finally {
        clearInterval(timer);
        await heartbeat;
      }
      if (once) return;
    } catch {
      if (shutdown.signal.aborted) return;
      console.error(
        "Voice worker operation failed. Unfinished claims recover after their lease expires. Check migrations and connectivity.",
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
    error instanceof VoiceError ||
      (error instanceof Error && error.message.startsWith("Worker configuration"))
      ? error.message
      : "The voice worker could not start. Check speech provider configuration.",
  );
  process.exitCode = 1;
});
