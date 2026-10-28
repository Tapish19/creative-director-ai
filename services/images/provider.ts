export interface ImageProvider {
  readonly name: string;
  readonly model: string;
  generate(request: {
    prompt: string;
    width: number;
    height: number;
    signal?: AbortSignal;
  }): Promise<{
    data: Uint8Array;
    contentType: "image/png" | "image/jpeg";
    provider: string;
  }>;
}
