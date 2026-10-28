import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiProvider } from "@/services/ai/gemini";
import { CloudflareImageProvider } from "@/services/images/cloudflare";
import { ImageError } from "@/services/images/errors";
import { processTextJob } from "@/services/jobs/text-pipeline";
import { processImageJob } from "@/services/jobs/image-pipeline";
import type { ImageJobClaim } from "@/services/jobs/image-store";
import { authenticated, OWNER, OTHER, testDatabase } from "../helpers/database";
import { SQLTextJobStore } from "../helpers/sql-store";
import { SQLImageJobStore } from "../helpers/image-store";
import { geminiResponse, testPlan, testScript } from "../fixtures/creative";

let db: PGlite;
let store: SQLImageJobStore;
let source: Buffer;
let generation: string;
const uploads = new Map<string, Uint8Array>();
const storage = {
  upload: vi.fn(async (path: string, data: Uint8Array) => {
    uploads.set(path, data);
  }),
};
function provider(fetcher?: typeof fetch) {
  return new CloudflareImageProvider({
    accountId: "a".repeat(32),
    apiToken: "test-only-token",
    fetch:
      fetcher ??
      vi.fn(async () =>
        Response.json({ success: true, result: { image: source.toString("base64") } }),
      ),
  });
}
async function claim() {
  const job = await store.claim(randomUUID());
  expect(job).not.toBeNull();
  return job as ImageJobClaim;
}
async function status() {
  return (
    await db.query<{ status: string }>("select status from public.generations where id=$1", [
      generation,
    ])
  ).rows[0].status;
}
async function expire(job: ImageJobClaim) {
  await db.query("update public.jobs set locked_until = now() - interval '1 second' where id=$1", [
    job.id,
  ]);
}
async function retry(sceneId: string, owner = OWNER) {
  return authenticated(db, owner, "select public.enqueue_scene_images($1,$2)", [
    generation,
    sceneId,
  ]);
}
async function finishRemaining() {
  while (true) {
    const job = await store.claim(randomUUID());
    if (!job) return;
    await processImageJob(store, provider(), storage, job);
  }
}
beforeAll(async () => {
  db = await testDatabase();
  store = new SQLImageJobStore(db);
  source = await sharp({ create: { width: 512, height: 512, channels: 3, background: "#ba90c5" } })
    .png()
    .toBuffer();
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
  const textStore = new SQLTextJobStore(db);
  const textJob = await textStore.claim(randomUUID());
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(geminiResponse(testPlan))
    .mockResolvedValueOnce(geminiResponse(testScript));
  await processTextJob(
    textStore,
    new GeminiProvider({ apiKey: "test-only-token", fetcher }),
    textJob!,
  );
});
afterAll(async () => {
  await db?.close();
});

describe("per-scene durable image generation", () => {
  it("automatically queues every written scene exactly once and persists real JPEGs and audits", async () => {
    expect(
      (await db.query("select * from public.jobs where kind='generate_image'")).rows,
    ).toHaveLength(3);
    expect(await status()).toBe("running");
    await finishRemaining();
    expect(await status()).toBe("running"); // Images finished; narration is queued.
    expect(
      (await db.query<{ status: string }>("select status from public.projects")).rows[0].status,
    ).toBe("generating");
    expect(uploads.size).toBe(3);
    for (const [path, data] of uploads) {
      expect(path).toMatch(new RegExp(`^${OWNER}/${generation}/[a-f0-9-]+/[a-f0-9-]+\\.jpg$`));
      expect(await sharp(data).metadata()).toMatchObject({
        format: "jpeg",
        width: 720,
        height: 1280,
      });
    }
    const runs = (
      await db.query<{ output: { path: string }; status: string }>(
        "select * from public.agent_runs where agent_type='images'",
      )
    ).rows;
    expect(runs).toHaveLength(3);
    expect(runs.every((run) => run.status === "succeeded" && uploads.has(run.output.path))).toBe(
      true,
    );
    expect(
      (
        await db.query(
          "select * from public.scenes where status='succeeded' and image_url is not null",
        )
      ).rows,
    ).toHaveLength(3);
    expect(await store.claim(randomUUID())).toBeNull();
  });
  it("lets sibling scenes complete when one image fails, then retries only the failed scene", async () => {
    const broken = await claim();
    await processImageJob(
      store,
      provider(vi.fn(async () => new Response("secret", { status: 403 }))),
      storage,
      broken,
    );
    await finishRemaining();
    expect(await status()).toBe("partial");
    expect(uploads.size).toBe(2);
    const preserved = [...uploads.keys()];
    await retry(broken.scene_id);
    expect(await status()).toBe("running");
    const next = await claim();
    expect(next.scene_id).toBe(broken.scene_id);
    await processImageJob(store, provider(), storage, next);
    expect(await status()).toBe("running"); // Images finished; narration is queued.
    expect([...uploads.keys()]).toEqual(expect.arrayContaining(preserved));
    expect(
      (
        await db.query<{ attempts: number; retry_count: number }>(
          "select attempts,retry_count from public.scenes where id=$1",
          [broken.scene_id],
        )
      ).rows[0],
    ).toEqual({ attempts: 2, retry_count: 1 });
    expect(
      (await db.query("select * from public.agent_runs where scene_id=$1", [broken.scene_id])).rows,
    ).toHaveLength(2);
  });
  it("honors a rate limit, preserves the script and avoids holding the worker during backoff", async () => {
    const job = await claim();
    expect(
      await processImageJob(
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
    const scheduled = (
      await db.query<{ seconds: number; status: string }>(
        "select status,extract(epoch from available_at-now())::float as seconds from public.jobs where id=$1",
        [job.id],
      )
    ).rows[0];
    expect(scheduled.status).toBe("queued");
    expect(scheduled.seconds).toBeGreaterThan(118);
    await finishRemaining();
    expect(uploads.size).toBe(2);
    expect(await status()).toBe("running");
    await db.query("update public.jobs set available_at=now() where id=$1", [job.id]);
    await finishRemaining();
    expect(await status()).toBe("running"); // Images finished; narration is queued.
    expect(
      (
        await db.query<{ script: unknown }>("select script from public.generations where id=$1", [
          generation,
        ])
      ).rows[0].script,
    ).toEqual(testScript);
  });
  it("caps automatic attempts and manual retries while retaining the full audit", async () => {
    const broken = await claim();
    const unavailable = provider(vi.fn(async () => new Response("busy", { status: 503 })));
    await processImageJob(store, unavailable, storage, broken);
    await finishRemaining();
    for (let attempt = 2; attempt <= 3; attempt++) {
      await db.query("update public.jobs set available_at=now() where id=$1", [broken.id]);
      await processImageJob(store, unavailable, storage, await claim());
    }
    expect(await status()).toBe("partial");
    expect(await store.claim(randomUUID())).toBeNull();
    const rejected = provider(vi.fn(async () => new Response("bad key", { status: 403 })));
    for (let manual = 0; manual < 2; manual++) {
      await retry(broken.scene_id);
      await processImageJob(store, rejected, storage, await claim());
    }
    await expect(retry(broken.scene_id)).rejects.toMatchObject({ code: "55000" });
    expect(
      (await db.query("select * from public.agent_runs where scene_id=$1", [broken.scene_id])).rows,
    ).toHaveLength(5);
    expect(uploads.size).toBe(2);
  });
  it("rejects stale completions after recovery and marks the interrupted attempt", async () => {
    const old = await claim();
    const run = await store.begin(old, {}, "cloudflare", "test");
    await expire(old);
    expect(await store.heartbeat(old)).toBe(false);
    // Make this expired job the first eligible item, independent of UUID ordering.
    await db.query("update public.jobs set available_at=now()-interval '1 day' where id=$1", [
      old.id,
    ]);
    const fresh = await claim();
    expect(fresh.id).toBe(old.id);
    expect(fresh.locked_by).not.toBe(old.locked_by);
    await expect(
      store.finish(old, run, { output: null, executionTime: 1, errorCode: "stale" }),
    ).rejects.toMatchObject({ code: "55000" });
    expect(
      (
        await db.query<{ error_code: string }>(
          "select error_code from public.agent_runs where id=$1",
          [run],
        )
      ).rows[0].error_code,
    ).toBe("worker_interrupted");
    await processImageJob(store, provider(), storage, fresh);
    await finishRemaining();
    expect(await status()).toBe("running"); // Images finished; narration is queued.
  });
  it("recovers a crash on the last claim without destroying sibling results", async () => {
    const job = await claim();
    await store.begin(job, {}, "cloudflare", "test");
    await db.query("update public.jobs set attempts=max_attempts where id=$1", [job.id]);
    await expire(job);
    await finishRemaining();
    expect(await status()).toBe("partial");
    expect(uploads.size).toBe(2);
    expect(
      (
        await db.query<{ status: string }>("select status from public.scenes where id=$1", [
          job.scene_id,
        ])
      ).rows[0].status,
    ).toBe("failed");
  });
  it("retries storage failures and never publishes a missing image", async () => {
    const job = await claim();
    const failingStorage = {
      upload: vi.fn(async () => {
        throw new ImageError("storage", "Private storage temporarily unavailable.", true);
      }),
    };
    expect(await processImageJob(store, provider(), failingStorage, job)).toBe("retry_scheduled");
    expect(
      (
        await db.query<{ image_url: string | null }>(
          "select image_url from public.scenes where id=$1",
          [job.scene_id],
        )
      ).rows[0].image_url,
    ).toBeNull();
    expect(uploads.size).toBe(0);
  });
  it("fences a lost lease after upload and never publishes or deletes an ambiguous asset", async () => {
    const job = await claim();
    const lostLeaseStorage = {
      upload: async (path: string, data: Uint8Array) => {
        await storage.upload(path, data);
        await expire(job);
      },
    };
    await expect(processImageJob(store, provider(), lostLeaseStorage, job)).rejects.toMatchObject({
      code: "55000",
    });
    expect(uploads.size).toBe(1);
    expect(
      (
        await db.query<{ image_url: string | null }>(
          "select image_url from public.scenes where id=$1",
          [job.scene_id],
        )
      ).rows[0].image_url,
    ).toBeNull();
    await finishRemaining();
    expect(await status()).toBe("running"); // Images finished; narration is queued.
    expect(uploads.size).toBe(4); // orphan remains private; it is not a committed scene output
  });
  it("validates the immutable owner/generation/scene/attempt path inside the commit", async () => {
    const job = await claim();
    const run = await store.begin(job, {}, "cloudflare", "test");
    await expect(
      store.finish(job, run, { output: { path: `${OTHER}/foreign.jpg` }, executionTime: 1 }),
    ).rejects.toMatchObject({ code: "22023" });
    await expect(store.begin(job, {}, "cloudflare", "test")).rejects.toMatchObject({
      code: "55000",
    });
    expect(
      (
        await db.query<{ status: string }>("select status from public.scenes where id=$1", [
          job.scene_id,
        ])
      ).rows[0].status,
    ).toBe("running");
  });
  it("prevents cross-tenant retries, client worker execution and duplicate claims", async () => {
    const job = await claim();
    const sibling = await claim();
    expect(sibling.id).not.toBe(job.id);
    await expect(retry(job.scene_id, OTHER)).rejects.toMatchObject({ code: "42501" });
    await expect(
      authenticated(db, OWNER, "select public.claim_image_job($1)", [randomUUID()]),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      authenticated(db, OWNER, "select public.queue_scene_images($1)", [generation]),
    ).rejects.toMatchObject({ code: "42501" });
    expect((await authenticated(db, OTHER, "select * from public.scenes")).rows).toHaveLength(0);
    await expect(retry(job.scene_id)).rejects.toMatchObject({ code: "55000" });
  });
  it("keeps private storage objects scoped to their owner", async () => {
    await db.query(
      "insert into storage.objects(bucket_id,name) values('creative-assets',$1),('creative-assets',$2)",
      [`${OWNER}/${generation}/one.jpg`, `${OTHER}/${generation}/two.jpg`],
    );
    const visible = await authenticated<{ name: string }>(
      db,
      OWNER,
      "select name from storage.objects",
    );
    expect(visible.rows).toEqual([{ name: `${OWNER}/${generation}/one.jpg` }]);
  });
  it("allows legacy script-ready versions to enqueue once without duplicating image jobs", async () => {
    // Simulate data written before migration 006, then use the public upgrade path.
    await db.exec("delete from public.jobs where kind='generate_image'");
    await db.query("update public.generations set status='script_ready' where id=$1", [generation]);
    await authenticated(db, OWNER, "select public.enqueue_scene_images($1)", [generation]);
    expect(
      (await db.query("select * from public.jobs where kind='generate_image'")).rows,
    ).toHaveLength(3);
    await expect(
      authenticated(db, OWNER, "select public.enqueue_scene_images($1)", [generation]),
    ).rejects.toMatchObject({ code: "55000" });
  });
});
