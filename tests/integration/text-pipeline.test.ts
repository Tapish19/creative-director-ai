import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiProvider } from "@/services/ai/gemini";
import { processTextJob } from "@/services/jobs/text-pipeline";
import { toJson, type JobClaim } from "@/services/jobs/store";
import { authenticated, OWNER, OTHER, service, testDatabase } from "../helpers/database";
import { SQLTextJobStore } from "../helpers/sql-store";
import { SQLImageJobStore } from "../helpers/image-store";
import { SQLVoiceJobStore } from "../helpers/voice-store";
import { completeReviewFixture } from "../helpers/review-store";
import { completeRenderFixture } from "../helpers/render-store";
import { geminiResponse, testPlan, testScript } from "../fixtures/creative";

let db: PGlite;
let store: SQLTextJobStore;

async function campaign(owner = OWNER) {
  const result = await authenticated<{ id: string }>(
    db,
    owner,
    `insert into public.projects (user_id, name, product_name, description, target_audience, tone, duration, goal)
    values ($1, 'Hotel campaign', 'MyHotelLine', 'Cloud hotel and restaurant management software', 'Independent hotel owners', 'Confident', 15, 'Book a free demo') returning id`,
    [owner],
  );
  return result.rows[0].id;
}

async function enqueue(projectId: string, requestKey = randomUUID(), owner = OWNER) {
  return (
    await authenticated<{ id: string }>(
      db,
      owner,
      "select public.enqueue_text_generation($1, $2) as id",
      [projectId, requestKey],
    )
  ).rows[0].id;
}

async function claim() {
  const job = await store.claim(randomUUID());
  expect(job).not.toBeNull();
  return job as JobClaim;
}

async function makeRetryDue() {
  await db.exec(
    "update public.jobs set available_at = now() - interval '1 second' where status = 'queued'",
  );
}

function providerWith(fetcher: typeof fetch) {
  return new GeminiProvider({ apiKey: "test-only-credential", fetcher });
}

beforeAll(async () => {
  db = await testDatabase();
  store = new SQLTextJobStore(db);
});
beforeEach(async () => {
  await db.exec("truncate public.projects cascade");
});
afterAll(async () => {
  await db?.close();
});

describe("PostgreSQL ownership and queue boundaries", () => {
  it("lets owners edit and delete ungenerated drafts without exposing another tenant's rows", async () => {
    const project = await campaign();
    expect(
      (
        await authenticated(
          db,
          OTHER,
          "update public.projects set tone = 'Intruder' where id = $1 returning id",
          [project],
        )
      ).rows,
    ).toHaveLength(0);
    const updated = await authenticated<{ tone: string }>(
      db,
      OWNER,
      "update public.projects set tone = 'Warm' where id = $1 returning tone",
      [project],
    );
    expect(updated.rows[0].tone).toBe("Warm");
    expect(
      (
        await authenticated(db, OTHER, "delete from public.projects where id = $1 returning id", [
          project,
        ])
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await authenticated(db, OWNER, "delete from public.projects where id = $1 returning id", [
          project,
        ])
      ).rows,
    ).toHaveLength(1);
  });

  it("keeps lineage frozen even if a privileged repair resets the project status to draft", async () => {
    const project = await campaign();
    await enqueue(project);
    await db.query("update public.projects set status = 'draft' where id = $1", [project]);
    expect(
      (
        await authenticated(
          db,
          OWNER,
          "update public.projects set tone = 'Changed' where id = $1 returning id",
          [project],
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await authenticated(db, OWNER, "delete from public.projects where id = $1 returning id", [
          project,
        ])
      ).rows,
    ).toHaveLength(0);
    const hidden = await authenticated<{ found: boolean }>(
      db,
      OTHER,
      "select public.has_own_generations($1) as found",
      [project],
    );
    expect(hidden.rows[0].found).toBe(false);
  });

  it("enqueues atomically with an immutable brief, one version and one durable job", async () => {
    const id = await campaign();
    const key = randomUUID();
    const generationId = await enqueue(id, key);
    expect(await enqueue(id, key)).toBe(generationId);
    expect(await enqueue(id)).toBe(generationId);
    const generation = await store.loadGeneration(generationId);
    expect(generation.version).toBe(1);
    expect(generation.brief_snapshot).toMatchObject({ product_name: "MyHotelLine", duration: 15 });
    expect(generation.brief_snapshot).not.toHaveProperty("user_id");
    expect((await db.query("select * from public.jobs")).rows).toHaveLength(1);
    const updated = await authenticated(
      db,
      OWNER,
      "update public.projects set tone = 'Rewritten' where id = $1 returning id",
      [id],
    );
    expect(updated.rows).toHaveLength(0);
  });

  it("protects another owner's campaign, child history, and worker RPCs", async () => {
    const project = await campaign();
    const generation = await enqueue(project);
    await expect(enqueue(project, randomUUID(), OTHER)).rejects.toMatchObject({ code: "42501" });
    expect(
      (
        await authenticated(db, OTHER, "select * from public.generations where id = $1", [
          generation,
        ])
      ).rows,
    ).toHaveLength(0);
    expect((await authenticated(db, OTHER, "select * from public.jobs")).rows).toHaveLength(0);
    await expect(
      authenticated(db, OWNER, "select public.claim_text_job($1)", [randomUUID()]),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      authenticated(db, OWNER, "update public.projects set status = 'approved' where id = $1", [
        project,
      ]),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      authenticated(db, OWNER, "update public.projects set user_id = $1 where id = $2", [
        OTHER,
        project,
      ]),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("rejects anonymous enqueue calls", async () => {
    const project = await campaign();
    await expect(
      db.transaction(async (tx) => {
        await tx.exec("set local role anon");
        await tx.query("select public.enqueue_text_generation($1, $2)", [project, randomUUID()]);
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("allows at most three active campaigns per account", async () => {
    for (let index = 0; index < 3; index++) await enqueue(await campaign());
    await expect(enqueue(await campaign())).rejects.toThrow("Too many active generations");
  });

  it("enforces the daily generation budget in the database", async () => {
    const project = await campaign();
    await db.query(
      `insert into public.generations (project_id, version, brief_snapshot, prompt, status)
      select $1, n, '{}'::jsonb, 'test', 'failed' from generate_series(1,20) n`,
      [project],
    );
    await expect(enqueue(project)).rejects.toThrow("Daily generation limit reached");
  });

  it("does not give the same live job to another worker", async () => {
    await enqueue(await campaign());
    await claim();
    expect(await store.claim(randomUUID())).toBeNull();
  });

  it("fences a stale worker after lease recovery and records its interrupted attempt", async () => {
    await enqueue(await campaign());
    const stale = await claim();
    const attempt = await store.begin(stale, "planner", {}, "gemini", "test-model");
    await db.query(
      "update public.jobs set locked_until = now() - interval '1 second' where id = $1",
      [stale.id],
    );
    const fresh = await claim();
    expect(fresh.locked_by).not.toBe(stale.locked_by);
    expect(await store.heartbeat(stale)).toBe(false);
    await expect(
      store.record(stale, attempt, {
        status: "succeeded",
        output: toJson(testPlan),
        model: "test",
        executionTime: 10,
      }),
    ).rejects.toMatchObject({ code: "55000" });
    expect((await store.listRuns(stale.generation_id))[0]).toMatchObject({
      status: "failed",
      error_code: "worker_interrupted",
    });
  });

  it("marks a worker crash on the final allowed claim as failed", async () => {
    const generation = await enqueue(await campaign());
    await db.query("update public.jobs set attempts = 4 where generation_id = $1", [generation]);
    const job = await claim();
    await store.begin(job, "planner", {}, "gemini", "test");
    await db.query(
      "update public.jobs set locked_until = now() - interval '1 second' where id = $1",
      [job.id],
    );
    expect(await store.claim(randomUUID())).toBeNull();
    expect((await store.loadGeneration(generation)).status).toBe("failed");
    expect((await store.listRuns(generation))[0].status).toBe("failed");
  });

  it("prevents duplicate running attempts and writer execution without a planner", async () => {
    await enqueue(await campaign());
    const job = await claim();
    await expect(store.begin(job, "writer", {}, "gemini", "test")).rejects.toThrow(
      "Planner result required",
    );
    await store.begin(job, "planner", {}, "gemini", "test");
    await expect(store.begin(job, "planner", {}, "gemini", "test")).rejects.toThrow(
      "already running",
    );
  });
});

describe("durable planner → writer orchestration", () => {
  it("persists both real adapter results, usage, scenes and the next image jobs together", async () => {
    const generation = await enqueue(await campaign());
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(geminiResponse(testPlan))
      .mockResolvedValueOnce(geminiResponse(testScript));
    expect(await processTextJob(store, providerWith(fetcher), await claim())).toBe("script_ready");
    const result = await store.loadGeneration(generation);
    expect(result.plan).toEqual(testPlan);
    expect(result.script).toEqual(testScript);
    expect(result.status).toBe("running");
    expect(
      (await db.query("select * from public.jobs where kind='generate_image' and status='queued'"))
        .rows,
    ).toHaveLength(3);
    expect(result.overall_score).toBeNull();
    const runs = await store.listRuns(generation);
    expect(runs).toHaveLength(2);
    expect(runs.every((run) => run.status === "succeeded")).toBe(true);
    expect(runs[0].usage).toEqual({ inputTokens: 120, outputTokens: 240 });
    const scenes = (
      await service(
        db,
        "select * from public.scenes where generation_id = $1 order by scene_number",
        [generation],
      )
    ).rows;
    expect(scenes).toHaveLength(3);
    expect(scenes[0]).toMatchObject({
      image_url: null,
      status: "pending",
      caption: testScript.scenes[0].caption,
    });
    expect(
      (
        await db.query<{ status: string }>(
          "select status from public.jobs where kind='plan_and_write'",
        )
      ).rows[0].status,
    ).toBe("succeeded");
    expect((await authenticated(db, OTHER, "select * from public.agent_runs")).rows).toHaveLength(
      0,
    );
    expect((await authenticated(db, OTHER, "select * from public.scenes")).rows).toHaveLength(0);
  });

  it("retains the planner and honors Retry-After when only the writer fails", async () => {
    const generation = await enqueue(await campaign());
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(geminiResponse(testPlan))
      .mockResolvedValueOnce(
        new Response("quota", { status: 429, headers: { "Retry-After": "120" } }),
      )
      .mockResolvedValueOnce(geminiResponse(testScript));
    const provider = providerWith(fetcher);
    expect(await processTextJob(store, provider, await claim())).toBe("retry_scheduled");
    expect((await store.loadGeneration(generation)).plan).toEqual(testPlan);
    expect(await store.claim(randomUUID())).toBeNull();
    const delay = (
      await db.query<{ seconds: number }>(
        "select extract(epoch from available_at - now())::float as seconds from public.jobs",
      )
    ).rows[0].seconds;
    expect(delay).toBeGreaterThan(110);
    await makeRetryDue();
    expect(await processTextJob(store, provider, await claim())).toBe("script_ready");
    expect(fetcher).toHaveBeenCalledTimes(3);
    const runs = await store.listRuns(generation);
    expect(runs.filter((run) => run.agent_type === "planner")).toHaveLength(1);
    expect(runs.filter((run) => run.agent_type === "writer")).toHaveLength(2);
  });

  it("feeds contract failures into the repair request instead of accepting invalid scenes", async () => {
    await enqueue(await campaign());
    const badScript = {
      ...testScript,
      scenes: testScript.scenes.map((scene) => ({ ...scene, duration: 6 })),
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(geminiResponse(testPlan))
      .mockResolvedValueOnce(geminiResponse(badScript))
      .mockResolvedValueOnce(geminiResponse(testScript));
    const provider = providerWith(fetcher);
    expect(await processTextJob(store, provider, await claim())).toBe("retry_scheduled");
    expect((await db.query("select * from public.scenes")).rows).toHaveLength(0);
    await makeRetryDue();
    expect(await processTextJob(store, provider, await claim())).toBe("script_ready");
    expect(String(fetcher.mock.calls[2][1]?.body)).toContain(
      "Scene durations must sum to exactly 15 seconds.",
    );
  });

  it("stops after three failed agent attempts, including after restarts", async () => {
    const generation = await enqueue(await campaign());
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response("unavailable", { status: 503 }));
    for (let attempt = 0; attempt < 3; attempt++) {
      await makeRetryDue();
      expect(
        await processTextJob(new SQLTextJobStore(db), providerWith(fetcher), await claim()),
      ).toBe(attempt === 2 ? "failed" : "retry_scheduled");
    }
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(await store.claim(randomUUID())).toBeNull();
    expect((await store.loadGeneration(generation)).status).toBe("failed");
    expect(await store.listRuns(generation)).toHaveLength(3);
  });

  it("does not automatically retry credential or safety failures", async () => {
    const generation = await enqueue(await campaign());
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("bad key", { status: 403 }));
    expect(await processTextJob(store, providerWith(fetcher), await claim())).toBe("failed");
    expect((await store.listRuns(generation))[0].error_code).toBe("configuration");
    expect(await store.claim(randomUUID())).toBeNull();
  });

  it("creates a new version on a new request while retaining the old one", async () => {
    const project = await campaign();
    const key = randomUUID();
    const first = await enqueue(project, key);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(geminiResponse(testPlan))
      .mockResolvedValueOnce(geminiResponse(testScript));
    await processTextJob(store, providerWith(fetcher), await claim());
    expect(await enqueue(project, key)).toBe(first);
    expect(await enqueue(project)).toBe(first); // The image stage still owns the active version.
    const images = new SQLImageJobStore(db);
    for (let index = 0; index < 3; index++) {
      const image = (await images.claim(randomUUID()))!;
      const run = await images.begin(image, {}, "test-only", "fixture");
      await images.finish(image, run, {
        output: { path: `${OWNER}/${first}/${image.scene_id}/${run}.jpg` },
        executionTime: 1,
      });
    }
    expect(await enqueue(project)).toBe(first); // Voice generation still owns this version.
    const voices = new SQLVoiceJobStore(db);
    const voiceJob = (await voices.claim(randomUUID()))!;
    const voiceRun = await voices.begin(voiceJob, {}, "test-only", "fixture");
    await voices.finish(voiceJob, voiceRun, {
      output: {
        path: `${OWNER}/${first}/voice/${voiceRun}.wav`,
        contentType: "audio/wav",
        durationSeconds: 10,
        sampleRate: 22050,
        sizeBytes: 441044,
        provider: "test-only",
        model: "fixture",
        voice: "fixture",
      },
      executionTime: 1,
    });
    expect(await enqueue(project)).toBe(first); // Rendering still owns this version.
    await completeRenderFixture(db, OWNER, first);
    expect(await enqueue(project)).toBe(first); // Review still owns this generation.
    await completeReviewFixture(db);
    const second = await enqueue(project);
    expect(second).not.toBe(first);
    expect((await store.loadGeneration(second)).version).toBe(2);
    expect((await store.loadGeneration(first)).script).toEqual(testScript);
  });

  it("rolls back scenes and terminal state if a writer result violates database constraints", async () => {
    const generation = await enqueue(await campaign());
    const job = await claim();
    const planner = await store.begin(job, "planner", {}, "gemini", "test");
    await store.record(job, planner, {
      status: "succeeded",
      output: toJson(testPlan),
      model: "test",
      executionTime: 1,
    });
    const writer = await store.begin(job, "writer", {}, "gemini", "test");
    const invalid = {
      ...testScript,
      scenes: testScript.scenes.map((scene) => ({ ...scene, sceneNumber: 1 })),
    };
    await expect(
      store.record(job, writer, {
        status: "succeeded",
        output: toJson(invalid),
        model: "test",
        executionTime: 1,
      }),
    ).rejects.toThrow("consecutively numbered");
    expect((await db.query("select * from public.scenes")).rows).toHaveLength(0);
    expect((await store.loadGeneration(generation)).status).toBe("running");
    expect((await store.listRuns(generation)).find((run) => run.id === writer.id)?.status).toBe(
      "running",
    );
  });
});
