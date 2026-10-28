import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { authenticated, service, OWNER, OTHER, testDatabase } from "../helpers/database";
import { seedCompletedVideo } from "../helpers/review-fixture";
import { SQLReviewJobStore, testReview } from "../helpers/review-store";
import type { Generation, GenerationApproval, Video, Review } from "@/types/generation";

let db: PGlite, id: string, video: Video, review: Review;
async function finishReview(score = 8, limit = 0) {
  const store = new SQLReviewJobStore(db),
    job = (await store.claim(randomUUID(), 8, limit))!;
  const run = await store.begin(job, {}, "test-only", "fixture");
  await store.finish(job, run, {
    output: {
      review: {
        ...testReview,
        hook_strength: score,
        clarity: score,
        audience_relevance: score,
        cta_strength: score,
        overall_score: score,
        problems: score < 8 ? ["Weak opening"] : [],
      },
      manifest: {
        videoId: video.id,
        sourcePath: video.video_url,
        sourceSha256: "a".repeat(64),
        submittedSha256: "a".repeat(64),
        scope: "video_and_audio",
      },
    },
    executionTime: 1,
    model: "fixture",
  });
  review = (await db.query<Review>("select * from public.reviews where generation_id=$1", [id]))
    .rows[0];
}
async function approve(
  options: {
    user?: string;
    confirmed?: boolean;
    low?: boolean;
    videoId?: string;
    reviewId?: string;
    note?: string;
  } = {},
) {
  return authenticated(
    db,
    options.user ?? OWNER,
    "select public.approve_generation($1,$2,$3,$4,$5,$6)",
    [
      id,
      options.videoId ?? video.id,
      options.reviewId ?? review.id,
      options.confirmed ?? true,
      options.low ?? false,
      options.note ?? "Ready for the campaign",
    ],
  );
}
async function generation(generationId = id) {
  return (
    await db.query<Generation>("select * from public.generations where id=$1", [generationId])
  ).rows[0];
}
async function approval() {
  return (
    await db.query<GenerationApproval>(
      "select * from public.generation_approvals where generation_id=$1",
      [id],
    )
  ).rows[0];
}
async function revise() {
  return (
    await authenticated<{ id: string }>(
      db,
      OWNER,
      "select public.enqueue_revision($1,$2,'feedback') as id",
      [id, randomUUID()],
    )
  ).rows[0].id;
}
beforeAll(async () => {
  db = await testDatabase();
});
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec("truncate public.projects cascade");
  id = await seedCompletedVideo(db);
  video = (await db.query<Video>("select * from public.videos where generation_id=$1", [id]))
    .rows[0];
});

describe("human approval transaction", () => {
  it("never approves on a passing AI score; owner approval saves exact evidence and campaign status", async () => {
    await finishReview();
    expect((await generation()).approved_at).toBeNull();
    expect(await approval()).toBeUndefined();
    await approve();
    const gen = await generation(),
      saved = await approval();
    expect(gen).toMatchObject({ status: "approved", approved_by: OWNER });
    expect(saved).toMatchObject({
      generation_id: id,
      video_id: video.id,
      review_id: review.id,
      video_path: video.video_url,
      source_sha256: "a".repeat(64),
      approved_by: OWNER,
      accepted_below_threshold: false,
    });
    expect(new Date(saved.approved_at).getTime()).toBe(new Date(gen.approved_at!).getTime());
    expect(
      (
        await db.query<{ status: string }>("select status from public.projects where id=$1", [
          gen.project_id,
        ])
      ).rows[0].status,
    ).toBe("approved");
  });
  it("replays approval without changing its timestamp or note, even after a child starts", async () => {
    await finishReview();
    await approve();
    const saved = await approval();
    const child = await revise();
    await approve({ note: "Changed on replay" });
    expect(await approval()).toEqual(saved);
    expect((await generation(child)).approved_by).toBeNull();
    expect(
      (await db.query<{ status: string }>("select status from public.projects")).rows[0].status,
    ).toBe("queued");
    await expect(approve({ videoId: randomUUID() })).rejects.toMatchObject({ code: "55000" });
  });
  it("requires explicit acknowledgment to approve below the threshold", async () => {
    await finishReview(6);
    await expect(approve()).rejects.toMatchObject({ code: "22023" });
    expect(await approval()).toBeUndefined();
    await approve({ low: true });
    const saved = await approval();
    expect(saved.accepted_below_threshold).toBe(true);
    expect(Number(saved.overall_score)).toBe(6);
    expect(Number(saved.quality_threshold)).toBe(8);
  });
  it("blocks approval while an automatic revision is active", async () => {
    await finishReview(6, 2);
    await expect(approve({ low: true })).rejects.toMatchObject({ code: "55000" });
    expect(await approval()).toBeUndefined();
  });
  it("allows choosing an older reviewed version after a newer attempt fails", async () => {
    await finishReview();
    const child = await revise();
    await db.query("update public.jobs set status='failed' where generation_id=$1", [child]);
    await db.query("update public.generations set status='failed' where id=$1", [child]);
    await approve();
    expect((await generation()).status).toBe("approved");
    expect((await generation(child)).status).toBe("failed");
  });
  it("rejects missing confirmation, oversized notes and mismatched video/review identities", async () => {
    await finishReview();
    for (const options of [{ confirmed: false }, { note: "x".repeat(2001) }])
      await expect(approve(options)).rejects.toMatchObject({ code: "22023" });
    for (const options of [{ videoId: randomUUID() }, { reviewId: randomUUID() }])
      await expect(approve(options)).rejects.toMatchObject({ code: "55000" });
    expect(await approval()).toBeUndefined();
  });
  it("rejects unreviewed and failed-review videos", async () => {
    await expect(approve({ reviewId: randomUUID() })).rejects.toMatchObject({ code: "55000" });
    await db.query(
      "update public.jobs set status='failed' where generation_id=$1 and kind='review'",
      [id],
    );
    await db.query("update public.generations set status='review_failed' where id=$1", [id]);
    await expect(approve({ reviewId: randomUUID() })).rejects.toMatchObject({ code: "55000" });
  });
  it.each(["path", "hash", "review", "status"])(
    "rejects changed %s evidence without a partial approval",
    async (change) => {
      await finishReview();
      if (change === "path")
        await db.query("update public.videos set video_url='changed.mp4' where id=$1", [video.id]);
      if (change === "hash")
        await db.query(
          "update public.videos set metadata=jsonb_build_object('sha256',repeat('b',64)) where id=$1",
          [video.id],
        );
      if (change === "review")
        await db.query("update public.reviews set source_sha256=repeat('b',64) where id=$1", [
          review.id,
        ]);
      if (change === "status")
        await db.query("update public.videos set status='failed' where id=$1", [video.id]);
      await expect(approve()).rejects.toMatchObject({ code: "55000" });
      expect(await approval()).toBeUndefined();
      expect((await generation()).approved_by).toBeNull();
    },
  );
  it("restricts decisions and audit reads to the owner; workers cannot approve", async () => {
    await finishReview();
    await expect(approve({ user: OTHER })).rejects.toMatchObject({ code: "42501" });
    await expect(
      service(
        db,
        "update public.generations set status='approved',approved_at=now(),approved_by=$2 where id=$1",
        [id, OWNER],
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      service(db, "select public.approve_generation($1,$2,$3,true)", [id, video.id, review.id]),
    ).rejects.toMatchObject({ code: "42501" });
    await approve();
    expect(
      (await authenticated(db, OTHER, "select * from public.generation_approvals")).rows,
    ).toHaveLength(0);
    expect(
      (await authenticated(db, OWNER, "select * from public.generation_approvals")).rows,
    ).toHaveLength(1);
    await expect(
      authenticated(db, OWNER, "update public.generations set approved_at=now() where id=$1", [id]),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      service(db, "update public.generation_approvals set note='forged' where generation_id=$1", [
        id,
      ]),
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("protects approved media and decision while revisions create independent records", async () => {
    await finishReview();
    await approve();
    const saved = await approval();
    await expect(
      service(
        db,
        "update public.generations set status='needs_revision',approved_by=null,approved_at=null where id=$1",
        [id],
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      service(db, "update public.videos set video_url='replaced.mp4' where id=$1", [video.id]),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      service(db, "delete from public.reviews where id=$1", [review.id]),
    ).rejects.toMatchObject({ code: "55000" });
    for (const action of ["enqueue_render", "enqueue_review", "enqueue_voice"])
      await expect(
        authenticated(db, OWNER, `select public.${action}($1)`, [id]),
      ).rejects.toMatchObject({ code: "55000" });
    const child = await revise();
    expect(await approval()).toEqual(saved);
    expect(await generation(child)).toMatchObject({
      status: "queued",
      approved_at: null,
      approved_by: null,
    });
  });
});
