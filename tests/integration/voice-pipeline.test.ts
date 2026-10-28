import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ElevenLabsVoiceProvider } from "@/services/voice/elevenlabs";
import { VoiceError } from "@/services/voice/errors";
import { inspectWav } from "@/services/voice/wav";
import { processVoiceJob } from "@/services/jobs/voice-pipeline";
import type { JobClaim } from "@/services/jobs/store";
import type { Voiceover } from "@/types/generation";
import { authenticated, OWNER, OTHER, testDatabase } from "../helpers/database";
import { SQLTextJobStore } from "../helpers/sql-store";
import { SQLImageJobStore } from "../helpers/image-store";
import { SQLVoiceJobStore } from "../helpers/voice-store";
import { testPlan, testScript } from "../fixtures/creative";
import { testPcm } from "../fixtures/audio";

let db: PGlite;
let store: SQLVoiceJobStore;
let generation: string;
const uploads = new Map<string, Uint8Array>();
const storage = {
  upload: vi.fn(async (path: string, data: Uint8Array) => {
    uploads.set(path, data);
  }),
};
const provider = (fetcher?: typeof fetch) =>
  new ElevenLabsVoiceProvider({
    apiKey: "test-only",
    voiceId: "voice-test",
    fetch:
      fetcher ??
      vi.fn(async () => new Response(testPcm(2), { headers: { "content-type": "audio/pcm" } })),
  });
async function claim() {
  const job = await store.claim(randomUUID());
  expect(job).not.toBeNull();
  return job as JobClaim;
}
async function speech() {
  return (
    await db.query<Voiceover>("select * from public.voiceovers where generation_id=$1", [
      generation,
    ])
  ).rows[0];
}
async function status() {
  return (
    await db.query<{ status: string }>("select status from public.generations where id=$1", [
      generation,
    ])
  ).rows[0].status;
}
async function retry(owner = OWNER) {
  return authenticated(db, owner, "select public.enqueue_voice($1)", [generation]);
}
async function expire(job: JobClaim) {
  await db.query("update public.jobs set locked_until=now()-interval '1 second' where id=$1", [
    job.id,
  ]);
}
beforeAll(async () => {
  db = await testDatabase();
  store = new SQLVoiceJobStore(db);
});
beforeEach(async () => {
  await db.exec("truncate public.projects cascade");
  uploads.clear();
  storage.upload.mockClear();
  const project = (
    await authenticated<{ id: string }>(
      db,
      OWNER,
      `insert into public.projects(user_id,name,product_name,description,target_audience,tone,duration,goal)
    values($1,'Hotel campaign','MyHotelLine','Cloud hotel and restaurant management software','Independent hotel owners','Confident',15,'Book a free demo') returning id`,
      [OWNER],
    )
  ).rows[0].id;
  generation = (
    await authenticated<{ id: string }>(
      db,
      OWNER,
      "select public.enqueue_text_generation($1,$2) as id",
      [project, randomUUID()],
    )
  ).rows[0].id;
  const texts = new SQLTextJobStore(db);
  const textJob = (await texts.claim(randomUUID()))!;
  const plan = await texts.begin(textJob, "planner", {}, "test", "test");
  await texts.record(textJob, plan, {
    status: "succeeded",
    output: testPlan,
    model: "test",
    executionTime: 1,
  });
  const script = await texts.begin(textJob, "writer", {}, "test", "test");
  await texts.record(textJob, script, {
    status: "succeeded",
    output: testScript,
    model: "test",
    executionTime: 1,
  });
  const images = new SQLImageJobStore(db);
  for (let index = 0; index < 3; index++) {
    const job = (await images.claim(randomUUID()))!;
    const run = await images.begin(job, {}, "test", "test");
    await images.finish(job, run, {
      output: { path: `${OWNER}/${generation}/${job.scene_id}/${run}.jpg` },
      executionTime: 1,
    });
  }
});
afterAll(async () => {
  await db?.close();
});
describe("durable voice pipeline", () => {
  it("queues speech only after images, persists measured WAV metadata and queues rendering", async () => {
    expect(
      (await db.query("select * from public.jobs where kind='synthesize_voice'")).rows,
    ).toHaveLength(1);
    expect((await speech()).narration).toBe(testScript.voiceover);
    const job = await claim();
    expect(await store.claim(randomUUID())).toBeNull();
    expect(await processVoiceJob(store, provider(), storage, job)).toBe("voice_ready");
    expect(await status()).toBe("running"); // Voice finished; rendering is queued.
    const result = await speech();
    expect(result).toMatchObject({
      status: "succeeded",
      duration_seconds: 2,
      sample_rate: 22050,
      provider: "elevenlabs",
      attempts: 1,
    });
    expect(inspectWav(uploads.get(result.audio_path!)!).durationSeconds).toBe(2);
    expect(
      (
        await db.query(
          "select * from public.agent_runs where agent_type='voice' and status='succeeded'",
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (await db.query("select * from public.scenes where status='succeeded'")).rows,
    ).toHaveLength(3);
    await expect(retry()).rejects.toMatchObject({ code: "55000" });
  });
  it("retains images through transient errors and honors Retry-After", async () => {
    const job = await claim();
    expect(
      await processVoiceJob(
        store,
        provider(
          vi.fn(
            async () => new Response("quota", { status: 429, headers: { "retry-after": "120" } }),
          ),
        ),
        storage,
        job,
      ),
    ).toBe("retry_scheduled");
    expect((await speech()).status).toBe("pending");
    expect(await status()).toBe("running");
    expect(uploads.size).toBe(0);
    const wait = (
      await db.query<{ seconds: number }>(
        "select extract(epoch from available_at-now())::float as seconds from public.jobs where id=$1",
        [job.id],
      )
    ).rows[0].seconds;
    expect(wait).toBeGreaterThan(118);
    expect(await store.claim(randomUUID())).toBeNull();
    await db.query("update public.jobs set available_at=now() where id=$1", [job.id]);
    await processVoiceJob(store, provider(), storage, await claim());
    expect(await status()).toBe("running"); // Voice finished; rendering is queued.
    expect((await speech()).attempts).toBe(2);
  });
  it("caps automatic retries at three and user restarts at two without losing audit history", async () => {
    const unavailable = provider(vi.fn(async () => new Response("busy", { status: 503 })));
    for (let attempt = 0; attempt < 3; attempt++) {
      await db.exec("update public.jobs set available_at=now() where kind='synthesize_voice'");
      await processVoiceJob(store, unavailable, storage, await claim());
    }
    expect(await status()).toBe("partial");
    expect(await store.claim(randomUUID())).toBeNull();
    const rejected = provider(vi.fn(async () => new Response("bad key", { status: 403 })));
    for (let count = 0; count < 2; count++) {
      await retry();
      await processVoiceJob(store, rejected, storage, await claim());
    }
    await expect(retry()).rejects.toMatchObject({ code: "55000" });
    expect((await speech()).attempts).toBe(5);
    expect(
      (await db.query("select * from public.agent_runs where agent_type='voice'")).rows,
    ).toHaveLength(5);
    expect(
      (await db.query("select * from public.scenes where status='succeeded'")).rows,
    ).toHaveLength(3);
  });
  it("fences stale audio commits and recovers interrupted attempts", async () => {
    const old = await claim();
    const run = await store.begin(old, {}, "test", "test");
    await expire(old);
    expect(await store.heartbeat(old)).toBe(false);
    const fresh = await claim();
    expect(fresh.locked_by).not.toBe(old.locked_by);
    await expect(
      store.finish(old, run, { output: null, errorCode: "stale", executionTime: 1 }),
    ).rejects.toMatchObject({ code: "55000" });
    await processVoiceJob(store, provider(), storage, fresh);
    expect(await status()).toBe("running"); // Voice finished; rendering is queued.
    expect(
      (
        await db.query<{ error_code: string }>(
          "select error_code from public.agent_runs where id=$1",
          [run],
        )
      ).rows[0].error_code,
    ).toBe("worker_interrupted");
  });
  it("fails a final-claim crash while preserving all images", async () => {
    const job = await claim();
    await store.begin(job, {}, "test", "test");
    await db.query("update public.jobs set attempts=max_attempts where id=$1", [job.id]);
    await expire(job);
    expect(await store.claim(randomUUID())).toBeNull();
    expect(await status()).toBe("partial");
    expect((await speech()).status).toBe("failed");
    expect(
      (await db.query("select * from public.scenes where status='succeeded'")).rows,
    ).toHaveLength(3);
  });
  it("never publishes invalid audio or failed uploads", async () => {
    const job = await claim();
    await processVoiceJob(
      store,
      provider(
        vi.fn(
          async () =>
            new Response(Buffer.alloc(44100), { headers: { "content-type": "audio/pcm" } }),
        ),
      ),
      storage,
      job,
    );
    expect(storage.upload).not.toHaveBeenCalled();
    expect((await speech()).audio_path).toBeNull();
    await db.query("update public.jobs set available_at=now() where id=$1", [job.id]);
    await processVoiceJob(
      store,
      provider(),
      {
        upload: async () => {
          throw new VoiceError("storage", "Private upload failed.", true);
        },
      },
      await claim(),
    );
    expect((await speech()).audio_path).toBeNull();
    expect(await status()).toBe("running");
  });
  it("leaves an interrupted upload private and unpublished until a valid lease commits", async () => {
    const job = await claim();
    const broken = {
      upload: async (path: string, data: Uint8Array) => {
        await storage.upload(path, data);
        await expire(job);
      },
    };
    await expect(processVoiceJob(store, provider(), broken, job)).rejects.toMatchObject({
      code: "55000",
    });
    expect((await speech()).audio_path).toBeNull();
    expect(uploads.size).toBe(1);
    await processVoiceJob(store, provider(), storage, await claim());
    expect(await status()).toBe("running"); // Voice finished; rendering is queued.
    expect(uploads.size).toBe(2);
  });
  it("rejects forged paths and incomplete metadata atomically", async () => {
    const job = await claim();
    const run = await store.begin(job, {}, "test", "test");
    await expect(
      store.finish(job, run, {
        output: { path: `${OTHER}/wrong.wav`, contentType: "audio/wav" },
        executionTime: 1,
      }),
    ).rejects.toMatchObject({ code: "22023" });
    await expect(
      store.finish(job, run, {
        output: { path: `${OWNER}/${generation}/voice/${run}.wav`, contentType: "audio/wav" },
        executionTime: 1,
      }),
    ).rejects.toMatchObject({ code: "23514" });
    expect((await speech()).status).toBe("running");
    expect((await speech()).audio_path).toBeNull();
    await expect(store.begin(job, {}, "test", "test")).rejects.toMatchObject({ code: "55000" });
  });
  it("enforces owner-only narration access and worker-only writes", async () => {
    expect((await authenticated(db, OTHER, "select * from public.voiceovers")).rows).toHaveLength(
      0,
    );
    await expect(retry(OTHER)).rejects.toMatchObject({ code: "42501" });
    await expect(
      authenticated(db, OWNER, "update public.voiceovers set status='succeeded'"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      authenticated(db, OWNER, "select public.claim_voice_job($1)", [randomUUID()]),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      authenticated(db, OWNER, "select public.queue_voice($1)", [generation]),
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("allows old image-ready versions to enter the voice pipeline exactly once", async () => {
    await db.exec(
      "delete from public.voiceovers; delete from public.jobs where kind='synthesize_voice'",
    );
    await db.query("update public.generations set status='images_ready' where id=$1", [generation]);
    await retry();
    expect(await status()).toBe("running");
    await expect(retry()).rejects.toMatchObject({ code: "55000" });
    expect(
      (await db.query("select * from public.jobs where kind='synthesize_voice'")).rows,
    ).toHaveLength(1);
  });
});
