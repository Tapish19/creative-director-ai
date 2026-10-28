import type { z } from "zod";

export type AIRequest<T> = {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  media?: { mimeType: "video/mp4"; data: Uint8Array };
  signal?: AbortSignal;
};

export type AIResult<T> = {
  data: T;
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
};

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  generateStructured<T>(request: AIRequest<T>): Promise<AIResult<T>>;
}
