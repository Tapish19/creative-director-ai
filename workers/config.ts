import { z } from "zod";
import { DEFAULT_GEMINI_MODEL } from "@/services/ai/gemini";

const workerSchema = z.object({
  SUPABASE_URL: z.url({ protocol: /^https?$/ }),
  SUPABASE_SERVICE_ROLE_KEY: z.string().trim().min(20),
  GEMINI_API_KEY: z.string().trim().min(1),
  GEMINI_MODEL: z.string().regex(/^gemini-[a-z0-9.-]+$/),
});

export function readWorkerConfig(env: Record<string, string | undefined>) {
  const result = workerSchema.safeParse({
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
    GEMINI_API_KEY: env.GEMINI_API_KEY,
    GEMINI_MODEL: env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL,
  });
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => issue.path[0]))].join(", ");
    throw new Error(
      `Worker configuration missing or invalid: ${names}. Add these server-side variables before starting the worker.`,
    );
  }
  return result.data;
}

export function readImageWorkerConfig(env: Record<string, string | undefined>) {
  const result = workerSchema
    .pick({ SUPABASE_URL: true, SUPABASE_SERVICE_ROLE_KEY: true })
    .extend({
      CLOUDFLARE_ACCOUNT_ID: z.string().regex(/^[a-f0-9]{32}$/i),
      CLOUDFLARE_API_TOKEN: z.string().trim().min(1),
    })
    .safeParse(env);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => issue.path[0]))].join(", ");
    throw new Error(
      `Worker configuration missing or invalid: ${names}. Add these server-side variables before starting the image worker.`,
    );
  }
  return result.data;
}

export function readVoiceWorkerConfig(env: Record<string, string | undefined>) {
  const result = workerSchema
    .pick({ SUPABASE_URL: true, SUPABASE_SERVICE_ROLE_KEY: true })
    .safeParse(env);
  if (!result.success)
    throw new Error(
      `Worker configuration missing or invalid: ${result.error.issues.map((issue) => issue.path[0]).join(", ")}. Configure the voice worker environment.`,
    );
  return result.data;
}

export function readRenderWorkerConfig(env: Record<string, string | undefined>) {
  const result = workerSchema
    .pick({ SUPABASE_URL: true, SUPABASE_SERVICE_ROLE_KEY: true })
    .safeParse(env);
  if (!result.success)
    throw new Error(
      `Worker configuration missing or invalid: ${result.error.issues.map((issue) => issue.path[0]).join(", ")}. Configure the render worker environment.`,
    );
  return result.data;
}

export function readReviewWorkerConfig(env: Record<string, string | undefined>) {
  const base = readWorkerConfig(env);
  const threshold = z.coerce
    .number()
    .min(1)
    .max(10)
    .multipleOf(0.1)
    .safeParse(env.QUALITY_THRESHOLD?.trim() || 8);
  if (!threshold.success)
    throw new Error(
      "Worker configuration missing or invalid: QUALITY_THRESHOLD must be 1-10 with at most one decimal.",
    );
  const limit = z.coerce
    .number()
    .int()
    .min(0)
    .max(2)
    .safeParse(env.MAX_AUTOMATIC_REVISIONS?.trim() || 2);
  if (!limit.success)
    throw new Error(
      "Worker configuration missing or invalid: MAX_AUTOMATIC_REVISIONS must be 0, 1 or 2.",
    );
  return { ...base, QUALITY_THRESHOLD: threshold.data, MAX_AUTOMATIC_REVISIONS: limit.data };
}
