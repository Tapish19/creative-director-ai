"use client";
import { useActionState, useState } from "react";
import { AudioLines, LoaderCircle } from "lucide-react";
import { enqueueVoice } from "@/app/campaigns/voice-actions";
import type { Voiceover } from "@/types/generation";
import type { ActionState } from "@/types/campaign";

export function VoicePanel({
  generationId,
  voiceover,
  targetDuration,
  canStart,
}: {
  generationId: string;
  voiceover: Voiceover | null;
  targetDuration: number;
  canStart: boolean;
}) {
  const [state, action, pending] = useActionState(
    enqueueVoice.bind(null, generationId),
    {} as ActionState,
  );
  const [playbackError, setPlaybackError] = useState(false);
  const [reload, setReload] = useState(0);
  const succeeded = voiceover?.status === "succeeded" && !!voiceover.audio_path;
  return (
    <section className="panel result-panel voice-panel">
      <div className="panel-heading">
        <div>
          <AudioLines size={18} />
          <h2>Voiceover</h2>
        </div>
        <span className="result-tag">{voiceover?.status ?? "Not started"}</span>
      </div>
      {succeeded ? (
        <>
          <p className="voice-description">
            {voiceover.provider === "local" ? "Local synthesized voice" : "ElevenLabs voice"} ·{" "}
            {voiceover.duration_seconds?.toFixed(1)}s narration · {targetDuration}s campaign
          </p>
          {voiceover.source_voiceover_id && (
            <p className="phase-note">
              Reused narration from the source version; the spoken words are unchanged.
            </p>
          )}
          <audio
            key={`${voiceover.attempts}-${reload}`}
            controls
            preload="none"
            src={`/api/generations/${generationId}/voice?v=${voiceover.attempts}&reload=${reload}`}
            onError={() => setPlaybackError(true)}
            onCanPlay={() => setPlaybackError(false)}
            aria-label="Generated advertisement voiceover"
          />
          {playbackError && (
            <div role="alert">
              <p className="field-error">
                Playback is unavailable or the link expired. Your saved audio is preserved.
              </p>
              <button
                className="button secondary"
                onClick={() => {
                  setPlaybackError(false);
                  setReload((value) => value + 1);
                }}
              >
                Reload audio
              </button>
            </div>
          )}
          {!!voiceover.duration_seconds && voiceover.duration_seconds > targetDuration && (
            <p className="field-error">
              Narration exceeds the target duration. Timing must be adjusted before final video
              rendering.
            </p>
          )}
          <p className="phase-note">
            {voiceover.model} · {voiceover.voice}. Listen alongside the transcript below. Video
            combines this narration with scene captions and animation.
          </p>
        </>
      ) : (
        <p className="voice-description">
          {voiceover?.status === "running"
            ? "Recording your narration…"
            : voiceover?.status === "pending"
              ? voiceover.error_message
                ? "A voice retry is scheduled. Completed images are saved."
                : "Narration is queued for the voice worker."
              : voiceover?.status === "failed"
                ? "Voice generation needs attention. Your script and images are saved."
                : "Narration starts after all scene images finish."}
        </p>
      )}
      {voiceover?.error_message && (
        <p className="field-error" role="alert">
          {voiceover.error_message}
        </p>
      )}
      {canStart && (!voiceover || (voiceover.status === "failed" && voiceover.retry_count < 2)) && (
        <form action={action} className="generate-form">
          <button className="button secondary" disabled={pending}>
            {pending ? <LoaderCircle size={15} className="spin" /> : <AudioLines size={15} />}
            {pending ? "Queuing…" : voiceover ? "Retry voiceover" : "Generate voiceover"}
          </button>
          {state.message && (
            <p className="field-error" role="alert">
              {state.message}
            </p>
          )}
        </form>
      )}
      {voiceover?.status === "failed" && voiceover.retry_count >= 2 && (
        <p className="phase-note">
          Voice retry limit reached. Resolve the reported issue before generating a new version.
        </p>
      )}
    </section>
  );
}
