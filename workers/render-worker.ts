import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { FFmpegRenderer } from "@/services/video/ffmpeg";
import { renderMusicPath } from "@/services/video/config";
import { SupabaseRenderStorage } from "@/services/video/storage";
import { SupabaseRenderJobStore } from "@/services/jobs/render-store";
import { processRenderJob } from "@/services/jobs/render-pipeline";
import { readRenderWorkerConfig } from "./config";
import { RenderError } from "@/services/video/errors";

async function main() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const config = readRenderWorkerConfig(process.env);
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
  const store = new SupabaseRenderJobStore(client);
  const storage = new SupabaseRenderStorage(client);
  const provider = new FFmpegRenderer();
  await provider.verifyRuntime();
  const musicPath = renderMusicPath();
  const workerId = randomUUID();
  const shutdown = new AbortController();
  process.once("SIGINT", () => shutdown.abort());
  process.once("SIGTERM", () => shutdown.abort());
  const once = process.argv.includes("--once");
  console.info(`Render worker started (${provider.name}). Waiting for render jobs.`);
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
        const outcome = await processRenderJob(store, provider, storage, job, {
          signal,
          musicPath,
        });
        console.info(`Generation ${job.generation_id}: ${outcome}`);
      } finally {
        clearInterval(timer);
        await heartbeat;
      }
      if (once) return;
    } catch {
      if (shutdown.signal.aborted) return;
      console.error(
        "Render worker operation failed. Unfinished claims recover after their lease expires. Check migrations and connectivity.",
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
    error instanceof RenderError ||
      (error instanceof Error && error.message.startsWith("Worker configuration"))
      ? error.message
      : "The render worker could not start. Check FFmpeg configuration.",
  );
  process.exitCode = 1;
});
