export class ImageError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
    public readonly retryAfterMs = 0,
  ) {
    super(message);
    this.name = "ImageError";
  }
}

export function normalizeImageError(error: unknown) {
  return error instanceof ImageError
    ? error
    : new ImageError("unavailable", "The image service could not complete this attempt.", true);
}
