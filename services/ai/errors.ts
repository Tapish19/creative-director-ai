export type AIErrorCode =
  | "configuration"
  | "rate_limit"
  | "timeout"
  | "unavailable"
  | "invalid_json"
  | "invalid_output"
  | "blocked"
  | "request_rejected"
  | "cancelled";

export class AIError extends Error {
  constructor(
    public readonly code: AIErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly details: {
      retryAfterMs?: number;
      rawText?: string;
      validationIssues?: string[];
    } = {},
  ) {
    super(message);
    this.name = "AIError";
  }
}

export function normalizeAIError(error: unknown): AIError {
  if (error instanceof AIError) return error;
  // Do not persist arbitrary exception messages: HTTP libraries can include credentials.
  return new AIError("unavailable", "The AI provider could not complete this attempt.", true);
}

export function retryDelayMs(attempt: number, retryAfterMs = 0, random = Math.random): number {
  const backoff = Math.min(60_000, 1_000 * 2 ** Math.max(0, attempt - 1));
  return Math.max(retryAfterMs, Math.round(backoff + backoff * 0.25 * random()));
}
