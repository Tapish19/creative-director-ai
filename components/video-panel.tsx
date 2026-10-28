"use client";
import { useActionState, useState } from "react";
import { Clapperboard, Download, LoaderCircle } from "lucide-react";
import { enqueueRender } from "@/app/campaigns/render-actions";
import type { Video } from "@/types/generation";
import type { ActionState } from "@/types/campaign";
export function VideoPanel({
  generationId,
  video,
  canStart,
}: {
  generationId: string;
  video: Video | null;
  canStart: boolean;
}) {
  const [state, action, pending] = useActionState(
    enqueueRender.bind(null, generationId),
    {} as ActionState,
  );
  const [playbackError, setPlaybackError] = useState(false),
    [reload, setReload] = useState(0);
  const ready = video?.status === "succeeded" && !!video.video_url;
  return (
    <section className="panel result-panel video-panel">
      <div className="panel-heading">
        <div>
          <Clapperboard size={18} />
          <h2>Your video</h2>
        </div>
        <span className="result-tag">{ready ? "MP4 ready" : (video?.status ?? "Not started")}</span>
      </div>
      {ready ? (
        <>
          <div className="video-preview">
            <video
              key={`${video.attempts}-${reload}`}
              controls
              playsInline
              preload="metadata"
              src={`/api/generations/${generationId}/video?v=${video.attempts}&reload=${reload}`}
              onError={() => setPlaybackError(true)}
              onCanPlay={() => setPlaybackError(false)}
              aria-label="Generated advertisement video"
            />
          </div>
          {playbackError && (
            <div role="alert">
              <p className="field-error">
                Playback is unavailable or the link expired. Your saved MP4 is preserved.
              </p>
              <button
                className="button secondary"
                onClick={() => {
                  setPlaybackError(false);
                  setReload((value) => value + 1);
                }}
              >
                Reload video
              </button>
            </div>
          )}
          <div className="video-toolbar">
            <span>
              {video.duration}s · {video.width} × {video.height} ·{" "}
              {((video.size_bytes ?? 0) / 1024 / 1024).toFixed(1)} MB
            </span>
            <a
              className="button primary"
              href={`/api/generations/${generationId}/video?download=1`}
            >
              <Download size={16} />
              Download MP4
            </a>
          </div>
          <p className="phase-note">
            Scene captions follow the storyboard timing. Check their pacing against the narration.
            See the creative review below. A score does not approve this video.
          </p>
        </>
      ) : (
        <div className="video-waiting">
          <Clapperboard size={34} />
          <h3>
            {video?.status === "running"
              ? "Putting your story in motion"
              : video?.status === "failed"
                ? "This render needs attention"
                : video?.status === "pending"
                  ? video.error_message
                    ? "Render retry scheduled"
                    : "Your video is queued"
                  : "Ready for the final assembly"}
          </h3>
          <p>
            {video?.status === "running"
              ? "Animating images, adding captions and combining the narration. You can leave this page while rendering continues."
              : "Your saved images and narration are assembled into a portrait MP4 by the background renderer."}
          </p>
        </div>
      )}
      {video?.error_message && (
        <p className="field-error" role="alert">
          {video.error_message}
        </p>
      )}
      {canStart && (!video || (video.status === "failed" && video.retry_count < 2)) && (
        <form action={action} className="generate-form">
          <button className="button secondary" disabled={pending}>
            {pending ? <LoaderCircle size={15} className="spin" /> : <Clapperboard size={15} />}{" "}
            {pending ? "Queuing…" : video ? "Retry render" : "Render video"}
          </button>
          {state.message && (
            <p className="field-error" role="alert">
              {state.message}
            </p>
          )}
        </form>
      )}
      {video?.status === "failed" && video.retry_count >= 2 && (
        <p className="phase-note">
          Render retry limit reached. Resolve the reported issue before starting a new version.
        </p>
      )}
    </section>
  );
}
