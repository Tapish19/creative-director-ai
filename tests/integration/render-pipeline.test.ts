import { randomUUID } from "node:crypto";
import { writeFile, access } from "node:fs/promises";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { processRenderJob } from "@/services/jobs/render-pipeline";
import { RenderError } from "@/services/video/errors";
import type { VideoRenderer } from "@/services/video/provider";
import type { Video } from "@/types/generation";
import { authenticated, OWNER, OTHER, testDatabase } from "../helpers/database";
import { SQLTextJobStore } from "../helpers/sql-store";
import { SQLImageJobStore } from "../helpers/image-store";
import { SQLVoiceJobStore } from "../helpers/voice-store";
import { SQLRenderJobStore } from "../helpers/render-store";
import { testPlan, testScript } from "../fixtures/creative";

let db: PGlite, store: SQLRenderJobStore, generation: string;
// These bytes exercise orchestration only. ffmpeg.test.ts renders and decodes real MP4s.
const uploads = new Map<string, Uint8Array>();
const downloads: string[] = [];
let temporaryOutput: string;
const storage = {
  download: vi.fn(async (path: string) => {
    downloads.push(path);
    return new Uint8Array(5000);
  }),
  upload: vi.fn(async (path: string, data: Uint8Array) => {
    uploads.set(path, data);
  }),
};
const renderer: VideoRenderer = {
  name: "test-only",
  version: "fixture",
  render: vi.fn(async (request) => {
    temporaryOutput = request.outputPath;
    await writeFile(request.outputPath, new Uint8Array(5000));
    return {
      path: request.outputPath,
      durationSeconds: request.targetDuration,
      sizeBytes: 5000,
      width: 720,
      height: 1280,
      fps: 30,
      narrationTempo: 1,
      musicIncluded: false,
    };
  }),
};
async function claim() {
  const job = await store.claim(randomUUID());
  expect(job).not.toBeNull();
  return job!;
}
async function video() {
  return (await db.query<Video>("select * from public.videos where generation_id=$1", [generation]))
    .rows[0];
}
async function status() {
  return (
    await db.query<{ status: string }>("select status from public.generations where id=$1", [
      generation,
    ])
  ).rows[0].status;
}
async function retry(owner = OWNER) {
  return authenticated(db, owner, "select public.enqueue_render($1)", [generation]);
}
async function expire(id: string) {
  await db.query("update public.jobs set locked_until=now()-interval '1 second' where id=$1", [id]);
}
beforeAll(async () => {
  db = await testDatabase();
  store = new SQLRenderJobStore(db);
});
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec("truncate public.projects cascade");
  uploads.clear();
  downloads.length = 0;
  vi.clearAllMocks();
  const project = (
    await authenticated<{ id: string }>(
      db,
      OWNER,
      `insert into public.projects(user_id,name,product_name,description,target_audience,tone,duration,goal)
    values($1,'Hotel campaign','MyHotelLine','Cloud hotel management software','Independent hotel owners','Confident',15,'Book a demo') returning id`,
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
  const texts = new SQLTextJobStore(db),
    textJob = (await texts.claim(randomUUID()))!;
  for (const [agent, output] of [
    ["planner", testPlan],
    ["writer", testScript],
  ] as const) {
    const run = await texts.begin(textJob, agent, {}, "test-only", "fixture");
    await texts.record(textJob, run, {
      status: "succeeded",
      output,
      model: "fixture",
      executionTime: 1,
    });
  }
  const images = new SQLImageJobStore(db);
  for (let index = 0; index < 3; index++) {
    const job = (await images.claim(randomUUID()))!,
      run = await images.begin(job, {}, "test-only", "fixture");
    await images.finish(job, run, {
      output: { path: `${OWNER}/${generation}/${job.scene_id}/${run}.jpg` },
      executionTime: 1,
    });
  }
  expect((await db.query("select * from public.jobs where kind='render'")).rows).toHaveLength(0);
  const voice = new SQLVoiceJobStore(db),
    job = (await voice.claim(randomUUID()))!,
    run = await voice.begin(job, {}, "test-only", "fixture");
  await voice.finish(job, run, {
    output: {
      path: `${OWNER}/${generation}/voice/${run}.wav`,
      contentType: "audio/wav",
      durationSeconds: 12,
      sampleRate: 22050,
      sizeBytes: 529244,
      voice: "fixture",
      provider: "test-only",
      model: "fixture",
    },
    executionTime: 1,
  });
});

describe("durable render pipeline", () => {
  it("atomically queues after speech, saves immutable output and audit, then queues review", async () => {
    expect((await db.query("select * from public.jobs where kind='render'")).rows).toHaveLength(1);
    const job = await claim();
    expect(await store.claim(randomUUID())).toBeNull();
    expect(await store.heartbeat(job)).toBe(true);
    expect(await processRenderJob(store, renderer, storage, job)).toBe("video_ready");
    expect(await status()).toBe("reviewing");
    const result = await video();
    expect(result).toMatchObject({
      status: "succeeded",
      width: 720,
      height: 1280,
      fps: 30,
      attempts: 1,
    });
    expect(Number(result.duration)).toBe(15);
    expect(uploads.has(result.video_url!)).toBe(true);
    expect(downloads).toHaveLength(4);
    expect(result.metadata).toMatchObject({
      captionTiming: "storyboard",
      videoCodec: "h264",
      audioCodec: "aac",
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const runs = (
      await db.query<{ input: unknown; status: string }>(
        "select input,status from public.agent_runs where agent_type='renderer'",
      )
    ).rows;
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      status: "succeeded",
      input: { voicePath: result.voice_url, targetDuration: 15 },
    });
    await expect(access(temporaryOutput)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(retry()).rejects.toMatchObject({ code: "55000" });
  });
  it("backs off transient rendering failures without discarding successful media", async () => {
    const job = await claim();
    const failing: VideoRenderer = {
      name: "test-only",
      render: async () => {
        throw new RenderError("ffmpeg_failed", "Rendering interrupted.", true);
      },
    };
    expect(await processRenderJob(store, failing, storage, job)).toBe("retry_scheduled");
    expect((await video()).status).toBe("pending");
    expect(await store.claim(randomUUID())).toBeNull();
    expect(
      (await db.query("select * from public.scenes where status='succeeded'")).rows,
    ).toHaveLength(3);
    expect(
      (await db.query("select * from public.voiceovers where status='succeeded'")).rows,
    ).toHaveLength(1);
    await db.query("update public.jobs set available_at=now() where id=$1", [job.id]);
    await processRenderJob(store, renderer, storage, await claim());
    expect((await video()).attempts).toBe(2);
    expect(await status()).toBe("reviewing");
  });
  it("caps three automatic claims and two explicit restarts while retaining all attempts", async () => {
    const failing: VideoRenderer = {
      name: "test-only",
      render: async () => {
        throw new RenderError("ffmpeg_failed", "Rendering interrupted.", true);
      },
    };
    for (let count = 0; count < 3; count++) {
      await db.exec("update public.jobs set available_at=now() where kind='render'");
      await processRenderJob(store, failing, storage, await claim());
    }
    expect(await status()).toBe("partial");
    expect(await store.claim(randomUUID())).toBeNull();
    const permanent: VideoRenderer = {
      name: "test-only",
      render: async () => {
        throw new RenderError("narration_too_long", "Shorten narration.", false);
      },
    };
    for (let count = 0; count < 2; count++) {
      await retry();
      await processRenderJob(store, permanent, storage, await claim());
    }
    await expect(retry()).rejects.toMatchObject({ code: "55000" });
    expect((await video()).attempts).toBe(5);
    expect(
      (await db.query("select * from public.agent_runs where agent_type='renderer'")).rows,
    ).toHaveLength(5);
  });
  it("recovers expired leases and rejects the old worker's commit", async () => {
    const old = await claim(),
      run = await store.begin(old, {}, "test-only", "fixture");
    await expire(old.id);
    expect(await store.heartbeat(old)).toBe(false);
    const fresh = await claim();
    expect(fresh.locked_by).not.toBe(old.locked_by);
    await expect(
      store.finish(old, run, { output: null, errorCode: "stale", executionTime: 1 }),
    ).rejects.toMatchObject({ code: "55000" });
    await processRenderJob(store, renderer, storage, fresh);
    expect(
      (
        await db.query<{ error_code: string }>(
          "select error_code from public.agent_runs where id=$1",
          [run],
        )
      ).rows[0].error_code,
    ).toBe("worker_interrupted");
    expect(await status()).toBe("reviewing");
  });
  it("marks a final-claim crash partial without losing images or narration", async () => {
    const job = await claim();
    await store.begin(job, {}, "test-only", "fixture");
    await db.query("update public.jobs set attempts=max_attempts where id=$1", [job.id]);
    await expire(job.id);
    expect(await store.claim(randomUUID())).toBeNull();
    expect(await status()).toBe("partial");
    expect((await video()).status).toBe("failed");
    expect(
      (await db.query("select * from public.scenes where status='succeeded'")).rows,
    ).toHaveLength(3);
  });
  it("does not publish a failed upload and removes temporary media", async () => {
    expect(
      await processRenderJob(
        store,
        renderer,
        {
          ...storage,
          upload: async () => {
            throw new RenderError("storage", "Upload unavailable.", true);
          },
        },
        await claim(),
      ),
    ).toBe("retry_scheduled");
    expect((await video()).video_url).toBeNull();
    await expect(access(temporaryOutput)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("keeps an upload private when its commit lease expires", async () => {
    const job = await claim();
    await expect(
      processRenderJob(
        store,
        renderer,
        {
          ...storage,
          upload: async (path, bytes) => {
            await storage.upload(path, bytes);
            await expire(job.id);
          },
        },
        job,
      ),
    ).rejects.toMatchObject({ code: "55000" });
    expect((await video()).video_url).toBeNull();
    expect(uploads.size).toBe(1);
    await processRenderJob(store, renderer, storage, await claim());
    expect(uploads.size).toBe(2);
    expect(await status()).toBe("reviewing");
  });
  it("rejects forged paths, wrong duration and incomplete metadata atomically", async () => {
    const job = await claim(),
      run = await store.begin(job, {}, "test-only", "fixture");
    const output = {
      path: `${OWNER}/${generation}/video/${run}.mp4`,
      contentType: "video/mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      durationSeconds: 15,
    };
    for (const altered of [
      { ...output, path: `${OTHER}/foreign.mp4` },
      { ...output, durationSeconds: 30 },
    ]) {
      await expect(
        store.finish(job, run, { output: altered, executionTime: 1 }),
      ).rejects.toMatchObject({ code: "22023" });
    }
    await expect(store.finish(job, run, { output, executionTime: 1 })).rejects.toMatchObject({
      code: "23514",
    });
    expect((await video()).video_url).toBeNull();
    expect((await video()).status).toBe("running");
  });
  it("enforces ownership and worker-only video mutations", async () => {
    expect((await authenticated(db, OTHER, "select * from public.videos")).rows).toHaveLength(0);
    await expect(retry(OTHER)).rejects.toMatchObject({ code: "42501" });
    await expect(
      authenticated(db, OWNER, "update public.videos set status='succeeded'"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      authenticated(db, OWNER, "select public.claim_render_job($1)", [randomUUID()]),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      authenticated(db, OWNER, "select public.queue_render($1)", [generation]),
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("queues existing media_ready versions once", async () => {
    await db.exec("delete from public.videos; delete from public.jobs where kind='render'");
    await db.query("update public.generations set status='media_ready' where id=$1", [generation]);
    await retry();
    await expect(retry()).rejects.toMatchObject({ code: "55000" });
    expect((await db.query("select * from public.jobs where kind='render'")).rows).toHaveLength(1);
  });
  it("leaves cancellation recoverable without publishing partial video", async () => {
    const job = await claim();
    await expect(
      processRenderJob(store, renderer, storage, job, { signal: AbortSignal.abort() }),
    ).rejects.toBeDefined();
    expect(renderer.render).not.toHaveBeenCalled();
    expect((await video()).video_url).toBeNull();
    await expire(job.id);
    await processRenderJob(store, renderer, storage, await claim());
    expect(await status()).toBe("reviewing");
  });
});
