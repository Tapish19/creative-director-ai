export interface VideoRenderer {
  readonly name: string;
  readonly version?: string;
  render(request: {
    scenes: Array<{ imagePath: string; duration: number; caption: string }>;
    voicePath: string;
    musicPath?: string;
    outputPath: string;
    width: number;
    height: number;
    targetDuration: 15 | 30;
    signal?: AbortSignal;
  }): Promise<{
    path: string;
    durationSeconds: number;
    sizeBytes: number;
    width: number;
    height: number;
    fps: number;
    narrationTempo: number;
    musicIncluded: boolean;
  }>;
}
