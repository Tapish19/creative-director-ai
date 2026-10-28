export class VoiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
    public readonly retryAfterMs = 0,
  ) {
    super(message);
    this.name = "VoiceError";
  }
}
export function normalizeVoiceError(error: unknown) {
  return error instanceof VoiceError
    ? error
    : new VoiceError("unavailable", "Voice generation could not complete this attempt.", true);
}
