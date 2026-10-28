export interface VoiceProvider {
  readonly name: string;
  readonly model: string;
  readonly voice: string;
  synthesize(request: { text: string; signal?: AbortSignal }): Promise<{
    data: Uint8Array;
    contentType: "audio/wav";
    durationSeconds: number;
    provider: string;
  }>;
}
