import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { authenticated, OWNER } from "./database";
import { SQLTextJobStore } from "./sql-store";
import { SQLImageJobStore } from "./image-store";
import { SQLVoiceJobStore } from "./voice-store";
import { completeRenderFixture } from "./render-store";
import { testPlan, testScript } from "../fixtures/creative";
export async function seedCompletedVideo(db: PGlite) {
  const project = (
    await authenticated<{ id: string }>(
      db,
      OWNER,
      `insert into public.projects(user_id,name,product_name,description,target_audience,tone,duration,goal)
    values($1,'Hotel campaign','MyHotelLine','Cloud hotel management software','Independent hotel owners','Confident',15,'Book a demo') returning id`,
      [OWNER],
    )
  ).rows[0].id;
  const generation = (
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
  await completeRenderFixture(db, OWNER, generation);
  return generation;
}
