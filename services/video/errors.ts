export class RenderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
    public readonly diagnostic?: string,
  ) {
    super(message);
    this.name = "RenderError";
  }
}
export function normalizeRenderError(error: unknown) {
  return error instanceof RenderError
    ? error
    : new RenderError("unavailable", "The renderer could not complete this attempt.", true);
}
