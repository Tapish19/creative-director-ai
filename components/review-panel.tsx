"use client";
import { useActionState } from "react";
import { ScanEye, LoaderCircle } from "lucide-react";
import { enqueueReview } from "@/app/campaigns/review-actions";
import type { ActionState } from "@/types/campaign";
import type { Review, ReviewTask } from "@/types/generation";
import type { Json } from "@/types/database";
const strings = (value: Json) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
export function ReviewPanel({
  generationId,
  review,
  task,
  canStart,
  approved = false,
}: {
  generationId: string;
  review: Review | null;
  task: ReviewTask | null;
  canStart: boolean;
  approved?: boolean;
}) {
  const [state, action, pending] = useActionState(
    enqueueReview.bind(null, generationId),
    {} as ActionState,
  );
  const passed = review && Number(review.overall_score) >= Number(review.quality_threshold);
  const dimensions = review
    ? ([
        ["Hook strength", review.hook_strength],
        ["Clarity", review.clarity],
        ["Audience relevance", review.audience_relevance],
        ["CTA strength", review.cta_strength],
      ] as const)
    : [];
  return (
    <section className="panel result-panel review-panel" aria-label="AI creative review">
      <div className="panel-heading">
        <div>
          <ScanEye size={18} />
          <h2>Creative review</h2>
        </div>
        <span className="result-tag">
          {review ? "Video + audio" : (task?.status ?? "Not started")}
        </span>
      </div>
      {review ? (
        <>
          <div className={`review-summary ${passed ? "review-pass" : "review-revise"}`}>
            <div>
              <strong>{Number(review.overall_score).toFixed(1)}</strong>
              <span> / 10</span>
            </div>
            <div>
              <h3>
                {passed ? "Meets the AI quality threshold" : "Below the AI quality threshold"}
              </h3>
              <p>
                Quality threshold: {Number(review.quality_threshold).toFixed(1)} ·{" "}
                {approved ? "Approved by you" : "Not approved"}
              </p>
            </div>
          </div>
          <div className="review-scores">
            {dimensions.map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>
                  {Number(value).toFixed(1)} <small>/ 10</small>
                </strong>
                <meter min="1" max="10" value={Number(value)} aria-label={label} />
              </div>
            ))}
          </div>
          <div className="review-feedback">
            <div>
              <h3>Problems to address</h3>
              {strings(review.problems).length ? (
                <ul>
                  {strings(review.problems).map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p>No material problems were reported by the reviewer.</p>
              )}
            </div>
            <div>
              <h3>Suggested improvements</h3>
              <ul>
                {strings(review.suggestions).map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
          <p className="phase-note">
            Overall is the mean of the four scores. AI assessment is subjective, can miss details,
            and does not predict conversion performance. Watch the video before deciding.
          </p>
          {review.input_manifest &&
            typeof review.input_manifest === "object" &&
            !Array.isArray(review.input_manifest) &&
            review.input_manifest.transcoded === true && (
              <p className="phase-note">
                Reviewed a compressed audiovisual copy of this MP4. The original download is
                unchanged.
              </p>
            )}
          <p className="phase-note">
            Reviewed with {review.model ?? "the configured model"}. Use Regenerate to apply this
            feedback to a new version. Human approval is recorded separately from these scores.
          </p>
        </>
      ) : (
        <div className="review-waiting">
          <h3>
            {task?.status === "running"
              ? "Watching and listening to your creative"
              : task?.status === "failed"
                ? "Review needs attention"
                : task?.status === "pending"
                  ? task.error_message
                    ? "Review retry scheduled"
                    : "Your review is queued"
                  : "Ready for a quality check"}
          </h3>
          <p>
            The reviewer evaluates the rendered video against your brief. Your MP4 remains available
            during review.
          </p>
        </div>
      )}
      {task?.error_message && (
        <p className="field-error" role="alert">
          {task.error_message}
        </p>
      )}
      {canStart && !review && (!task || (task.status === "failed" && task.retry_count < 2)) && (
        <form action={action} className="generate-form">
          <button className="button secondary" disabled={pending}>
            {pending ? <LoaderCircle size={15} className="spin" /> : <ScanEye size={15} />}{" "}
            {pending ? "Queuing…" : task ? "Retry review" : "Review video"}
          </button>
          {state.message && (
            <p className="field-error" role="alert">
              {state.message}
            </p>
          )}
        </form>
      )}
      {task?.status === "failed" && task.retry_count >= 2 && (
        <p className="phase-note">Review retry limit reached. The completed MP4 is preserved.</p>
      )}
    </section>
  );
}
