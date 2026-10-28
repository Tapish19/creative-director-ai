"use client";
import { useActionState, useId } from "react";
import { CheckCircle2, Download, LoaderCircle } from "lucide-react";
import { approveGeneration, type ApprovalActionState } from "@/app/campaigns/approval-actions";
import type { GenerationApproval } from "@/types/generation";

export function ApprovalPanel({
  generationId,
  version,
  videoId,
  reviewId,
  score,
  threshold,
  approval,
  eligible,
  campaignActive,
}: {
  generationId: string;
  version: number;
  videoId: string;
  reviewId: string;
  score: number;
  threshold: number;
  approval: GenerationApproval | null;
  eligible: boolean;
  campaignActive: boolean;
}) {
  const [state, action, pending] = useActionState(
    approveGeneration.bind(null, generationId, videoId, reviewId),
    {} as ApprovalActionState,
  );
  const prefix = useId();
  const below = Number(score) < Number(threshold);
  return (
    <section className="panel result-panel approval-panel" aria-label="Human approval">
      <div className="panel-heading">
        <div>
          <CheckCircle2 size={18} />
          <h2>
            {approval || state.success ? `Version ${version} approved` : "Your final decision"}
          </h2>
        </div>
        <span className="result-tag">Human approval</span>
      </div>
      {approval || state.success ? (
        <>
          <p role="status">
            You approved this version
            {approval
              ? ` on ${new Date(approval.approved_at).toLocaleString("en", { timeZone: "UTC" })} UTC`
              : ""}
            . Future edits create a new version and require their own approval.
          </p>
          {approval?.accepted_below_threshold && (
            <p className="phase-note">
              Approved with acknowledgment of the AI score:{" "}
              {Number(approval.overall_score).toFixed(1)} / 10, below the saved{" "}
              {Number(approval.quality_threshold).toFixed(1)} threshold.
            </p>
          )}
          {approval?.note && <p className="approval-decision-note">{approval.note}</p>}
          {approval && (
            <details>
              <summary>Approval record</summary>
              <dl className="approval-record">
                <dt>Approved by (account ID)</dt>
                <dd>{approval.approved_by}</dd>
                <dt>Video ID</dt>
                <dd>{approval.video_id}</dd>
                <dt>Review ID</dt>
                <dd>{approval.review_id}</dd>
                <dt>MP4 SHA-256</dt>
                <dd>{approval.source_sha256}</dd>
              </dl>
            </details>
          )}
          <a className="button primary" href={`/api/generations/${generationId}/video?download=1`}>
            <Download size={16} />
            Download approved MP4
          </a>
        </>
      ) : campaignActive ? (
        <p role="status">
          Wait for the campaign&apos;s active version to finish before approving. You can then
          choose this version or a newer one.
        </p>
      ) : !eligible ? (
        <p>Approval becomes available after this video&apos;s review finishes successfully.</p>
      ) : (
        <form action={action} className="revision-form">
          <p>
            Approve version {version} and its saved MP4. Watch the video and read the review before
            deciding. This records your decision; it does not publish the advertisement.
          </p>
          <fieldset disabled={pending}>
            <label className="approval-check">
              <input type="checkbox" name="confirmed" required />I have watched this version and
              reviewed its feedback.
            </label>
            {below && (
              <label className="approval-check">
                <input type="checkbox" name="acceptLowScore" required />I accept the score of{" "}
                {Number(score).toFixed(1)} / 10, below the {Number(threshold).toFixed(1)} threshold,
                and want to approve this version.
              </label>
            )}
            <div className="field">
              <label htmlFor={`${prefix}-note`}>Decision note (optional)</label>
              <textarea
                id={`${prefix}-note`}
                name="note"
                rows={3}
                maxLength={2000}
                placeholder="Why this creative is ready for your campaign…"
              />
            </div>
            <button className="button primary" disabled={pending}>
              {pending ? <LoaderCircle size={16} className="spin" /> : <CheckCircle2 size={16} />}
              {pending ? "Saving approval…" : `Approve version ${version}`}
            </button>
          </fieldset>
          {state.message && (
            <p className="field-error" role="alert">
              {state.message}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
