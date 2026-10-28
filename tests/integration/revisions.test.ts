import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { authenticated, OWNER, OTHER, testDatabase } from "../helpers/database";
import { seedCompletedVideo } from "../helpers/review-fixture";
import { SQLReviewJobStore, testReview, completeReviewFixture } from "../helpers/review-store";
import { SQLTextJobStore } from "../helpers/sql-store";
import { SQLImageJobStore } from "../helpers/image-store";
import { SQLVoiceJobStore } from "../helpers/voice-store";
import { SQLRenderJobStore, completeRenderFixture } from "../helpers/render-store";
import { testScript, testPlan, geminiResponse } from "../fixtures/creative";
import { editedScript } from "@/types/revision";
import { processTextJob } from "@/services/jobs/text-pipeline";
import { processRenderJob } from "@/services/jobs/render-pipeline";
import { GeminiProvider } from "@/services/ai/gemini";
import type { Generation, Scene, Voiceover } from "@/types/generation";
import type { Json } from "@/types/database";

let db: PGlite, parentId: string;
const low = {
  ...testReview,
  hook_strength: 6,
  clarity: 7,
  audience_relevance: 7,
  cta_strength: 7.6,
  overall_score: 6.9,
  problems: ["Scene 1 has a generic hook."],
  suggestions: ["Open with the hotel owner's booking problem."],
};
async function generation(id: string) {
  return (await db.query<Generation>("select * from public.generations where id=$1", [id])).rows[0];
}
async function scenes(id: string) {
  return (
    await db.query<Scene>(
      "select * from public.scenes where generation_id=$1 order by scene_number",
      [id],
    )
  ).rows;
}
async function speech(id: string) {
  return (await db.query<Voiceover>("select * from public.voiceovers where generation_id=$1", [id]))
    .rows[0];
}
async function revisions() {
  return (await db.query<Generation>("select * from public.generations order by version")).rows;
}
async function revise(
  mode = "feedback",
  options: {
    owner?: string;
    parent?: string;
    key?: string;
    instruction?: string;
    script?: Json;
    sceneId?: string;
    prompt?: string;
  } = {},
) {
  return (
    await authenticated<{ id: string }>(
      db,
      options.owner ?? OWNER,
      "select public.enqueue_revision($1,$2,$3,$4,$5,$6,$7) as id",
      [
        options.parent ?? parentId,
        options.key ?? randomUUID(),
        mode,
        options.instruction ?? "",
        options.script ? JSON.stringify(options.script) : null,
        options.sceneId ?? null,
        options.prompt ?? null,
      ],
    )
  ).rows[0].id;
}
async function review(id: string, score = low, limit = 2, threshold = 8) {
  const store = new SQLReviewJobStore(db),
    job = (await store.claim(randomUUID(), threshold, limit))!;
  expect(job.generation_id).toBe(id);
  const context = await store.load(job),
    run = await store.begin(job, { promptVersion: "test-only" }, "test-only", "fixture");
  await store.finish(job, run, {
    output: {
      review: score,
      manifest: {
        videoId: context.video.id,
        sourcePath: context.video.video_url,
        sourceSha256: "a".repeat(64),
        submittedSha256: "a".repeat(64),
        scope: "video_and_audio",
      },
    },
    executionTime: 1,
    model: "fixture",
  });
  return { store, job, run };
}
async function finishImages(id: string) {
  const images = new SQLImageJobStore(db);
  while (true) {
    const job = await images.claim(randomUUID());
    if (!job) break;
    expect(job.generation_id).toBe(id);
    const run = await images.begin(job, {}, "test-only", "fixture");
    await images.finish(job, run, {
      output: { path: `${OWNER}/${id}/${job.scene_id}/${run}.jpg` },
      executionTime: 1,
    });
  }
}
async function finishCreative(id: string) {
  const texts = new SQLTextJobStore(db),
    job = await texts.claim(randomUUID());
  if (job) {
    expect(job.generation_id).toBe(id);
    const fetcher = vi.fn<typeof fetch>(async (_url, init) =>
      geminiResponse(
        JSON.parse(String(init?.body)).contents[0].parts[0].text.startsWith("Plan a")
          ? testPlan
          : testScript,
      ),
    );
    await processTextJob(texts, new GeminiProvider({ apiKey: "test-only", fetcher }), job);
  }
  await finishImages(id);
  const voice = new SQLVoiceJobStore(db),
    voiceJob = await voice.claim(randomUUID());
  if (voiceJob) {
    expect(voiceJob.generation_id).toBe(id);
    const run = await voice.begin(voiceJob, {}, "test-only", "fixture");
    await voice.finish(voiceJob, run, {
      output: {
        path: `${OWNER}/${id}/voice/${run}.wav`,
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
  }
  await completeRenderFixture(db, OWNER, id);
}
beforeAll(async () => {
  db = await testDatabase();
});
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec("truncate public.projects cascade");
  parentId = await seedCompletedVideo(db);
});
describe("versioned regeneration", () => {
  it("creates a feedback child once, preserves its source and supplies the saved review to both agents", async () => {
    await review(parentId, low, 0);
    const original = await generation(parentId),
      key = randomUUID();
    const child = await revise("feedback", { key, instruction: "Focus on booking chaos." });
    expect(await revise("feedback", { key, instruction: "Focus on booking chaos." })).toBe(child);
    await expect(
      revise("feedback", { key, instruction: "Different content under the same key." }),
    ).rejects.toMatchObject({ code: "22023" });
    await expect(revise()).rejects.toMatchObject({ code: "55000" });
    const next = await generation(child);
    expect(next).toMatchObject({
      parent_generation_id: parentId,
      version: 2,
      revision_mode: "feedback",
      automatic_revision: 0,
      status: "queued",
      script: null,
      plan: null,
      overall_score: null,
    });
    expect(next.revision_context).toMatchObject({
      instruction: "Focus on booking chaos.",
      review: low,
      previousScript: testScript,
    });
    const fetcher = vi.fn<typeof fetch>(async (_url, init) =>
      geminiResponse(
        JSON.parse(String(init?.body)).contents[0].parts[0].text.startsWith("Plan a")
          ? testPlan
          : testScript,
      ),
    );
    const store = new SQLTextJobStore(db),
      job = (await store.claim(randomUUID()))!;
    await processTextJob(store, new GeminiProvider({ apiKey: "test-only", fetcher }), job);
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const call of fetcher.mock.calls) {
      const body = String(call[1]?.body);
      expect(body).toContain("Focus on booking chaos.");
      expect(body).toContain("generic hook");
    }
    expect((await generation(parentId)).script).toEqual(original.script);
    expect((await generation(parentId)).overall_score).toEqual(original.overall_score);
    expect(
      (await scenes(child)).every(
        (scene) => scene.source_scene_id === null && scene.status === "pending",
      ),
    ).toBe(true);
  });
  it("runs at most two automatic revisions, inherits the gate/budget and stops for human review", async () => {
    await review(parentId, low, 2, 8);
    let versions = await revisions();
    expect(versions).toHaveLength(2);
    const first = versions[1];
    expect(first).toMatchObject({
      parent_generation_id: parentId,
      revision_mode: "automatic",
      automatic_revision: 1,
      automatic_revision_limit: 2,
      status: "queued",
    });
    await finishCreative(first.id);
    await review(first.id, low, 0, 1);
    versions = await revisions();
    expect(versions).toHaveLength(3);
    const second = versions[2];
    expect(Number((await generation(first.id)).quality_threshold)).toBe(8);
    expect(second).toMatchObject({
      parent_generation_id: first.id,
      automatic_revision: 2,
      automatic_revision_limit: 2,
    });
    await finishCreative(second.id);
    await review(second.id, low, 2);
    expect(await revisions()).toHaveLength(3);
    expect(await generation(second.id)).toMatchObject({
      status: "needs_revision",
      automatic_revision_stop_reason: "limit_reached",
      automatic_revision: 2,
    });
    expect((await db.query("select * from public.reviews")).rows).toHaveLength(3);
    expect(
      (await db.query("select * from public.videos where status='succeeded'")).rows,
    ).toHaveLength(3);
    expect(
      (await db.query("select * from public.jobs where status in ('queued','running')")).rows,
    ).toHaveLength(0);
    expect(
      (await db.query("select * from public.generations where approved_at is not null")).rows,
    ).toHaveLength(0);
  });
  it("stops immediately when a revision passes the threshold", async () => {
    await review(parentId);
    const child = (await revisions())[1];
    await finishCreative(child.id);
    await review(child.id, testReview, 2);
    expect(await revisions()).toHaveLength(2);
    expect((await generation(child.id)).status).toBe("awaiting_approval");
  });
  it.each([0, 1])("honors an automatic revision cap of %s", async (limit) => {
    await review(parentId, low, limit);
    if (limit === 1) {
      const child = (await revisions())[1];
      await finishCreative(child.id);
      await review(child.id);
    }
    const versions = await revisions();
    expect(versions).toHaveLength(limit + 1);
    expect(versions.at(-1)?.automatic_revision_stop_reason).toBe("limit_reached");
  });
  it("does not duplicate automatic children when a stale completion is replayed", async () => {
    const { store, job, run } = await review(parentId);
    await expect(
      store.finish(job, run, {
        output: null,
        errorCode: "stale",
        executionTime: 1,
        model: "fixture",
      }),
    ).rejects.toMatchObject({ code: "55000" });
    expect(await revisions()).toHaveLength(2);
  });
  it("commits a low review even when the daily quota prevents another automatic version", async () => {
    const parent = await generation(parentId);
    for (let version = 2; version <= 20; version++)
      await db.query(
        "insert into public.generations(project_id,version,brief_snapshot,prompt,status) values($1,$2,$3,'Quota fixture','failed')",
        [parent.project_id, version, JSON.stringify(parent.brief_snapshot)],
      );
    await review(parentId);
    expect((await generation(parentId)).automatic_revision_stop_reason).toBe("quota_reached");
    expect((await db.query("select * from public.reviews")).rows).toHaveLength(1);
    expect(await revisions()).toHaveLength(20);
    await expect(revise()).rejects.toMatchObject({ code: "P0001" });
  });
  it("saves caption edits as a new version, reuses media, and renders from their immutable source paths", async () => {
    await completeReviewFixture(db);
    const beforeScenes = await scenes(parentId),
      beforeVoice = await speech(parentId);
    const edited = editedScript(
      testScript.scenes.map((scene, index) => ({
        ...scene,
        caption: index === 0 ? "Bookings without the paperwork" : scene.caption,
      })),
      15,
    );
    const child = await revise("script_edit", { script: edited });
    expect(await generation(child)).toMatchObject({
      revision_mode: "script_edit",
      automatic_revision_limit: 0,
      overall_score: null,
    });
    const saved = await scenes(child);
    expect(saved.map((scene) => scene.image_url)).toEqual(
      beforeScenes.map((scene) => scene.image_url),
    );
    expect(
      saved.every(
        (scene) => scene.status === "succeeded" && scene.source_generation_id === parentId,
      ),
    ).toBe(true);
    expect((await speech(child)).audio_path).toBe(beforeVoice.audio_path);
    expect(
      (
        await db.query<{ kind: string }>("select kind from public.jobs where generation_id=$1", [
          child,
        ])
      ).rows.map((row) => row.kind),
    ).toEqual(["render"]);
    expect((await scenes(parentId))[0].caption).toBe(testScript.scenes[0].caption);
    const downloads: string[] = [],
      renderStore = new SQLRenderJobStore(db),
      job = (await renderStore.claim(randomUUID()))!;
    await processRenderJob(
      renderStore,
      {
        name: "test-only",
        render: async (request) => {
          await writeFile(request.outputPath, new Uint8Array(5000));
          return {
            path: request.outputPath,
            durationSeconds: 15,
            sizeBytes: 5000,
            width: 720,
            height: 1280,
            fps: 30,
            narrationTempo: 1,
            musicIncluded: false,
          };
        },
      },
      {
        download: async (path) => {
          downloads.push(path);
          return new Uint8Array(5000);
        },
        upload: async () => {},
      },
      job,
    );
    expect(downloads).toEqual([
      ...beforeScenes.map((scene) => scene.image_url),
      beforeVoice.audio_path,
    ]);
    expect((await generation(child)).status).toBe("reviewing");
    // The render fixture has a checksum, so this case ends at the fresh queued review.
    expect(
      (await db.query("select * from public.reviews where generation_id=$1", [child])).rows,
    ).toHaveLength(0);
  });
  it("regenerates exactly one selected image, reuses voice and preserves flattened lineage through another edit", async () => {
    await completeReviewFixture(db);
    const old = await scenes(parentId),
      voice = await speech(parentId);
    const child = await revise("scene", { sceneId: old[1].id, prompt: old[1].visual_prompt });
    const saved = await scenes(child);
    expect(saved.map((scene) => scene.status)).toEqual(["succeeded", "pending", "succeeded"]);
    expect(
      (
        await db.query(
          "select * from public.jobs where generation_id=$1 and kind='generate_image'",
          [child],
        )
      ).rows,
    ).toHaveLength(1);
    expect((await speech(child)).audio_path).toBe(voice.audio_path);
    expect(saved[1].image_url).toBeNull();
    await finishCreative(child);
    await review(child, low, 2);
    expect((await generation(child)).automatic_revision_stop_reason).toBe("manual_edit");
    expect(await revisions()).toHaveLength(2);
    const grandchild = await revise("script_edit", {
      parent: child,
      script: editedScript(
        testScript.scenes.map((scene) => ({ ...scene, caption: scene.caption + "!" })),
        15,
      ),
    });
    const final = await scenes(grandchild);
    expect(final[0].source_generation_id).toBe(parentId);
    expect(final[1].source_generation_id).toBe(child);
    expect(final[2].source_generation_id).toBe(parentId);
    expect((await speech(grandchild)).source_generation_id).toBe(parentId);
  });
  it("queues new narration when spoken words change while preserving unchanged images", async () => {
    await completeReviewFixture(db);
    const child = await revise("script_edit", {
      script: editedScript(
        testScript.scenes.map((scene, index) => ({
          ...scene,
          voiceover: index === 0 ? "Still handling bookings by hand?" : scene.voiceover,
        })),
        15,
      ),
    });
    expect((await scenes(child)).every((scene) => scene.status === "succeeded")).toBe(true);
    expect((await speech(child)).audio_path).toBeNull();
    expect(
      (
        await db.query<{ kind: string }>("select kind from public.jobs where generation_id=$1", [
          child,
        ])
      ).rows.map((row) => row.kind),
    ).toEqual(["synthesize_voice"]);
  });
  it("supports a four-scene edit while reusing only matching saved visuals", async () => {
    await completeReviewFixture(db);
    const changed = editedScript(
      [
        ...testScript.scenes.map((scene) => ({ ...scene, duration: 4 })),
        {
          sceneNumber: 4,
          duration: 3,
          voiceover: "Try it today.",
          caption: "Your next step",
          visualPrompt: "A welcoming hotel reception with soft natural daylight and no text.",
        },
      ],
      15,
    );
    const child = await revise("script_edit", { script: changed });
    expect((await scenes(child)).map((scene) => scene.status)).toEqual([
      "succeeded",
      "succeeded",
      "succeeded",
      "pending",
    ]);
    expect(await scenes(parentId)).toHaveLength(3);
    expect(
      (
        await db.query(
          "select * from public.jobs where generation_id=$1 and kind='generate_image'",
          [child],
        )
      ).rows,
    ).toHaveLength(1);
    await finishImages(child);
    expect((await speech(child)).status).toBe("pending");
  });
  it("validates edits in PostgreSQL even if the server action is bypassed", async () => {
    await completeReviewFixture(db);
    const invalid = [
      { ...testScript, voiceover: "Not the saved narration" },
      { ...testScript, scenes: testScript.scenes.slice(0, 2) },
      {
        ...testScript,
        scenes: testScript.scenes.map((scene, index) => ({
          ...scene,
          duration: index === 0 ? 4 : 5,
        })),
      },
      {
        ...testScript,
        scenes: testScript.scenes.map((scene, index) => ({
          ...scene,
          sceneNumber: index === 0 ? 2 : scene.sceneNumber,
        })),
      },
      {
        ...testScript,
        scenes: testScript.scenes.map((scene) => ({ ...scene, caption: "x".repeat(81) })),
      },
      { ...testScript, extra: "unsupported" },
    ];
    for (const script of invalid)
      await expect(revise("script_edit", { script })).rejects.toMatchObject({ code: "22023" });
    expect(await revisions()).toHaveLength(1);
  });
  it("enforces ownership, valid scene membership and worker-only automatic revisions", async () => {
    await completeReviewFixture(db);
    await expect(revise("feedback", { owner: OTHER })).rejects.toMatchObject({ code: "42501" });
    await expect(revise("automatic")).rejects.toMatchObject({ code: "22023" });
    await expect(
      revise("scene", { sceneId: randomUUID(), prompt: testScript.scenes[0].visualPrompt }),
    ).rejects.toMatchObject({ code: "22023" });
    await expect(
      authenticated(db, OWNER, "select public.maybe_queue_automatic_revision($1)", [parentId]),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      authenticated(db, OWNER, "update public.scenes set source_generation_id=$1", [parentId]),
    ).rejects.toMatchObject({ code: "42501" });
    const child = await revise();
    expect(
      (await authenticated(db, OTHER, "select * from public.generations where id=$1", [child]))
        .rows,
    ).toHaveLength(0);
  });
});
