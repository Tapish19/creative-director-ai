import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiProvider } from "@/services/ai/gemini";
import { processReviewJob } from "@/services/jobs/review-pipeline";
import type { ReviewMedia } from "@/services/video/review-media";
import { RenderError } from "@/services/video/errors";
import { authenticated, OWNER, OTHER, testDatabase } from "../helpers/database";
import { SQLReviewJobStore, testReview } from "../helpers/review-store";
import { seedCompletedVideo } from "../helpers/review-fixture";
import { geminiResponse } from "../fixtures/creative";

let db: PGlite, store: SQLReviewJobStore, generation: string;
// Controlled transport and media for orchestration. Native media validation has separate tests.
const media: ReviewMedia = {
  prepare: vi.fn<ReviewMedia["prepare"]>(async (video) => ({
    data: new Uint8Array([1, 2, 3]),
    manifest: {
      videoId: video.id,
      sourcePath: video.video_url!,
      sourceSha256: "a".repeat(64),
      submittedSha256: "a".repeat(64),
      scope: "video_and_audio",
      transcoded: false,
      durationSeconds: 15,
      sizeBytes: 3,
      width: 720,
      height: 1280,
    },
  })),
};
const provider = (fetcher: typeof fetch = vi.fn(async () => geminiResponse(testReview))) =>
  new GeminiProvider({ apiKey: "test-only", fetcher });
async function claim(threshold = 8) {
  const job = await store.claim(randomUUID(), threshold);
  expect(job).not.toBeNull();
  return job!;
}
async function status() {
  return (
    await db.query<{ status: string }>("select status from public.generations where id=$1", [
      generation,
    ])
  ).rows[0].status;
}
async function retry(owner = OWNER) {
  return authenticated(db, owner, "select public.enqueue_review($1)", [generation]);
}
async function expire(id: string) {
  await db.query("update public.jobs set locked_until=now()-interval '1 second' where id=$1", [id]);
}
beforeAll(async () => {
  db = await testDatabase();
  store = new SQLReviewJobStore(db);
});
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec("truncate public.projects cascade");
  vi.clearAllMocks();
  generation = await seedCompletedVideo(db);
});
describe("durable audiovisual review", () => {
  it("queues atomically after render, submits actual media input and persists scores/evidence at the inclusive gate", async () => {
    expect(await status()).toBe("reviewing");
    expect((await db.query("select * from public.jobs where kind='review'")).rows).toHaveLength(1);
    const fetcher = vi.fn<typeof fetch>(async () => geminiResponse(testReview)),
      job = await claim();
    expect(await store.claim(randomUUID())).toBeNull();
    expect(await store.heartbeat(job)).toBe(true);
    expect(await processReviewJob(store, provider(fetcher), media, job)).toBe("reviewed");
    expect(await status()).toBe("awaiting_approval");
    const request = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(request.contents[0].parts[0].inlineData).toEqual({
      mimeType: "video/mp4",
      data: "AQID",
    });
    const review = (
      await db.query<{
        overall_score: string;
        quality_threshold: string;
        source_sha256: string;
        model: string;
      }>("select * from public.reviews")
    ).rows[0];
    expect(Number(review.overall_score)).toBe(8);
    expect(Number(review.quality_threshold)).toBe(8);
    expect(review.source_sha256).toBe("a".repeat(64));
    expect(review.model).toBe("gemini-test-version");
    const run = (
      await db.query<{
        input: Record<string, unknown>;
        output: Record<string, unknown>;
        usage: unknown;
      }>("select * from public.agent_runs where agent_type='reviewer'")
    ).rows[0];
    expect(run.input.promptVersion).toBe("reviewer.audiovisual.v1");
    expect(run.input.prompt).toContain("MyHotelLine");
    expect(run.usage).toEqual({ inputTokens: 120, outputTokens: 240 });
    expect(JSON.stringify(run)).not.toContain('"AQID"');
    expect(
      (await db.query("select * from public.generations where approved_at is not null")).rows,
    ).toHaveLength(0);
    await expect(retry()).rejects.toMatchObject({ code: "55000" });
  });
  it("saves a below-threshold score and feedback without starting automatic revisions", async () => {
    const low = {
      ...testReview,
      hook_strength: 6,
      clarity: 7,
      audience_relevance: 7,
      cta_strength: 7.6,
      overall_score: 6.9,
      problems: ["The opening scene is too generic."],
    };
    await processReviewJob(
      store,
      provider(vi.fn(async () => geminiResponse(low))),
      media,
      await claim(),
    );
    expect(await status()).toBe("needs_revision");
    expect((await db.query("select * from public.generations")).rows).toHaveLength(1);
    expect(
      (await db.query<{ problems: unknown }>("select problems from public.reviews")).rows[0]
        .problems,
    ).toEqual(low.problems);
    expect(
      (await db.query("select * from public.videos where status='succeeded'")).rows,
    ).toHaveLength(1);
  });
  it("snapshots threshold on the first claim and preserves it across retries and worker configuration changes", async () => {
    const job = await claim(8.5);
    await processReviewJob(
      store,
      provider(vi.fn(async () => new Response("denied", { status: 403 }))),
      media,
      job,
    );
    expect(await status()).toBe("review_failed");
    await retry();
    const next = await claim(2);
    expect(Number((await store.load(next)).generation.quality_threshold)).toBe(8.5);
    const feedback = { ...testReview, problems: ["The opening could be more specific."] };
    await processReviewJob(
      store,
      provider(vi.fn(async () => geminiResponse(feedback))),
      media,
      next,
    );
    expect(await status()).toBe("needs_revision");
  });
  it("rejects malformed structured scores, supplies validation repair feedback and succeeds on a later claim", async () => {
    const first = await claim();
    expect(
      await processReviewJob(
        store,
        provider(vi.fn(async () => geminiResponse({ ...testReview, overall_score: 9 }))),
        media,
        first,
      ),
    ).toBe("retry_scheduled");
    expect((await db.query("select * from public.reviews")).rows).toHaveLength(0);
    await db.query("update public.jobs set available_at=now() where id=$1", [first.id]);
    const fetcher = vi.fn<typeof fetch>(async () => geminiResponse(testReview));
    await processReviewJob(store, provider(fetcher), media, await claim());
    expect(String(fetcher.mock.calls[0][1]?.body)).toContain("Overall score must equal");
    expect(await status()).toBe("awaiting_approval");
  });
  it("honors rate limits and bounds automatic claims and owner restarts", async () => {
    const limited = provider(
      vi.fn(async () => new Response("secret", { status: 429, headers: { "retry-after": "120" } })),
    );
    for (let count = 0; count < 3; count++) {
      await db.exec("update public.jobs set available_at=now() where kind='review'");
      const job = await claim();
      await processReviewJob(store, limited, media, job);
      if (count < 2) expect(await store.claim(randomUUID())).toBeNull();
    }
    expect(await status()).toBe("review_failed");
    expect(await store.claim(randomUUID())).toBeNull();
    const permanent = provider(vi.fn(async () => new Response("bad key", { status: 403 })));
    for (let count = 0; count < 2; count++) {
      await retry();
      await processReviewJob(store, permanent, media, await claim());
    }
    await expect(retry()).rejects.toMatchObject({ code: "55000" });
    expect(
      (await db.query("select * from public.agent_runs where agent_type='reviewer'")).rows,
    ).toHaveLength(5);
    expect(
      (await db.query("select * from public.videos where status='succeeded'")).rows,
    ).toHaveLength(1);
  });
  it("fences stale commits and recovers an interrupted reviewer", async () => {
    const old = await claim(),
      run = await store.begin(old, {}, "test-only", "fixture");
    await expire(old.id);
    expect(await store.heartbeat(old)).toBe(false);
    const fresh = await claim();
    await expect(
      store.finish(old, run, {
        output: null,
        errorCode: "stale",
        executionTime: 1,
        model: "fixture",
      }),
    ).rejects.toMatchObject({ code: "55000" });
    await processReviewJob(store, provider(), media, fresh);
    expect(await status()).toBe("awaiting_approval");
    expect(
      (
        await db.query<{ error_code: string }>(
          "select error_code from public.agent_runs where id=$1",
          [run],
        )
      ).rows[0].error_code,
    ).toBe("worker_interrupted");
  });
  it("ends a final-claim crash without discarding or approving the completed video", async () => {
    const job = await claim();
    await store.begin(job, {}, "test-only", "fixture");
    await db.query("update public.jobs set attempts=max_attempts where id=$1", [job.id]);
    await expire(job.id);
    expect(await store.claim(randomUUID())).toBeNull();
    expect(await status()).toBe("review_failed");
    expect(
      (await db.query("select * from public.videos where status='succeeded'")).rows,
    ).toHaveLength(1);
    expect((await db.query("select * from public.reviews")).rows).toHaveLength(0);
  });
  it("does not send media to the model when stored video validation fails", async () => {
    const fetcher = vi.fn<typeof fetch>(),
      broken: ReviewMedia = {
        prepare: async () => {
          throw new RenderError("invalid_video", "Checksum mismatch.", false);
        },
      };
    expect(await processReviewJob(store, provider(fetcher), broken, await claim())).toBe(
      "review_failed",
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(await status()).toBe("review_failed");
  });
  it("rejects forged evidence, inconsistent scores and empty low-score feedback atomically", async () => {
    const job = await claim(),
      context = await store.load(job),
      run = await store.begin(job, {}, "test-only", "fixture");
    const prepared = await media.prepare(context.video, OWNER, generation);
    const invalid = [
      { review: testReview, manifest: { ...prepared.manifest, videoId: randomUUID() } },
      { review: { ...testReview, overall_score: 9 }, manifest: prepared.manifest },
      {
        review: {
          ...testReview,
          hook_strength: 6,
          clarity: 6,
          audience_relevance: 6,
          cta_strength: 6,
          overall_score: 6,
        },
        manifest: prepared.manifest,
      },
    ];
    for (const output of invalid)
      await expect(
        store.finish(job, run, { output, executionTime: 1, model: "fixture" }),
      ).rejects.toMatchObject({ code: "22023" });
    expect((await db.query("select * from public.reviews")).rows).toHaveLength(0);
    expect(await status()).toBe("reviewing");
  });
  it("enforces owner-only reads and retries and worker-only scoring writes", async () => {
    expect((await authenticated(db, OTHER, "select * from public.review_tasks")).rows).toHaveLength(
      0,
    );
    await expect(retry(OTHER)).rejects.toMatchObject({ code: "42501" });
    await expect(
      authenticated(db, OWNER, "update public.reviews set overall_score=10"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      authenticated(db, OWNER, "select public.claim_review_job($1,8)", [randomUUID()]),
    ).rejects.toMatchObject({ code: "42501" });
    await processReviewJob(store, provider(), media, await claim());
    expect((await authenticated(db, OTHER, "select * from public.reviews")).rows).toHaveLength(0);
    expect((await authenticated(db, OWNER, "select * from public.reviews")).rows).toHaveLength(1);
  });
  it("supports one review enqueue for legacy video_ready generations", async () => {
    await db.exec("delete from public.review_tasks; delete from public.jobs where kind='review'");
    await db.query("update public.generations set status='video_ready' where id=$1", [generation]);
    await retry();
    await expect(retry()).rejects.toMatchObject({ code: "55000" });
    expect((await db.query("select * from public.jobs where kind='review'")).rows).toHaveLength(1);
  });
  it("leaves cancellation for lease recovery and never writes a score", async () => {
    const job = await claim(),
      fetcher = vi.fn<typeof fetch>();
    await expect(
      processReviewJob(store, provider(fetcher), media, job, AbortSignal.abort()),
    ).rejects.toBeDefined();
    expect(fetcher).not.toHaveBeenCalled();
    expect((await db.query("select * from public.reviews")).rows).toHaveLength(0);
    await expire(job.id);
    await processReviewJob(store, provider(), media, await claim());
    expect(await status()).toBe("awaiting_approval");
  });
});
