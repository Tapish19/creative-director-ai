import { ApprovalPanel } from "@/components/approval-panel";
import { RevisionControls } from "@/components/revision-controls";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Clock3, FileCheck2, TriangleAlert, RefreshCw } from "lucide-react";
import { randomUUID } from "node:crypto";
import { getProject } from "@/lib/projects/repository";
import { getGeneration, listGenerations, getActiveGeneration } from "@/lib/generations/repository";
import { planSchema, scriptSchema } from "@/types/creative";
import { Pipeline } from "@/components/pipeline";
import { GenerationMonitor } from "@/components/generation-monitor";
import { GenerateButton } from "@/components/generate-button";
import { AgentAudit, CreativeTextResults } from "@/components/creative-text-results";
import { ImageActionButton } from "@/components/image-action-button";
import { VoicePanel } from "@/components/voice-panel";
import { ReviewPanel } from "@/components/review-panel";
import { VideoPanel } from "@/components/video-panel";

export const metadata = { title: "Creative generation" };

export default async function GenerationPage({
  params,
}: {
  params: Promise<{ id: string; generationId: string }>;
}) {
  const { id, generationId } = await params;
  const project = await getProject(id);
  const [
    { generation, runs, job, scenes, voiceover, video, review, reviewTask, approval },
    versions,
    activeVersion,
  ] = await Promise.all([
    getGeneration(id, generationId),
    listGenerations(id),
    getActiveGeneration(id),
  ]);
  const active =
    generation.status === "queued" ||
    generation.status === "running" ||
    generation.status === "reviewing";
  const campaignActive = !!activeVersion;
  const automaticChild = versions.find(
    (version) =>
      version.parent_generation_id === generationId && version.revision_mode === "automatic",
  );
  const stopReasons = {
    limit_reached:
      "Automatic revision limit reached. Human review is required; you can also request another version.",
    quota_reached:
      "Automatic revision stopped at the account generation limit. Your review and video are saved.",
    manual_edit:
      "Automatic rewrites are off for this edited version. Use Regenerate if you want AI to apply the review feedback.",
  };
  const plan = planSchema.safeParse(generation.plan);
  const script = scriptSchema.safeParse(generation.script);
  const ready = [
    "script_ready",
    "images_ready",
    "media_ready",
    "video_ready",
    "awaiting_approval",
    "needs_revision",
    "approved",
  ].includes(generation.status);
  const partial = generation.status === "partial";
  const failed = generation.status === "failed";
  const title = approval
    ? "Your creative is approved."
    : review
      ? generation.status === "needs_revision"
        ? "A stronger direction is within reach."
        : "Ready for your creative judgment."
      : generation.status === "review_failed"
        ? "Your video is ready. Review needs attention."
        : generation.status === "video_ready"
          ? "Your story, in motion."
          : ready
            ? "Your story, scene by scene."
            : failed || partial
              ? "This generation needs attention."
              : "Your creative is taking shape.";

  return (
    <>
      <Link className="back-link" href={`/campaigns/${id}`}>
        <ArrowLeft size={15} />
        {project.product_name} campaign
      </Link>
      <div className="page-heading">
        <div>
          <div className="eyebrow">CREATIVE GENERATION · VERSION {generation.version}</div>
          <h1>{title}</h1>
          <p>
            {project.name} <span className="text-separator">/</span> {project.duration}-second
            creative
          </p>
        </div>
        <span className={`generation-state state-${generation.status}`}>
          {ready ? (
            <FileCheck2 size={16} />
          ) : failed || partial ? (
            <TriangleAlert size={16} />
          ) : (
            <Clock3 size={16} />
          )}
          {generation.status === "approved"
            ? "Approved"
            : generation.status === "needs_revision"
              ? "Needs revision"
              : generation.status === "awaiting_approval"
                ? "Needs approval"
                : generation.status === "reviewing"
                  ? "Reviewing"
                  : generation.status === "review_failed"
                    ? "Review needs attention"
                    : ready
                      ? generation.status === "video_ready"
                        ? "Video ready"
                        : generation.status === "media_ready"
                          ? "Images & voice ready"
                          : generation.status === "images_ready"
                            ? "Images ready"
                            : "Script ready"
                      : partial
                        ? "Media needs attention"
                        : failed
                          ? "Failed"
                          : generation.status === "queued"
                            ? "Queued"
                            : "Running"}
        </span>
      </div>
      <GenerationMonitor
        id={activeVersion?.id ?? generationId}
        active={campaignActive}
        revision={activeVersion?.updated_at ?? generation.updated_at}
      />
      {generation.parent_generation_id && (
        <p className="revision-lineage">
          <Link
            className="text-link"
            href={`/campaigns/${id}/generations/${generation.parent_generation_id}`}
          >
            View source version
          </Link>{" "}
          ? {generation.revision_mode.replaceAll("_", " ")}
          {generation.revision_mode === "automatic"
            ? ` ? Automatic revision ${generation.automatic_revision} of ${generation.automatic_revision_limit}`
            : ""}
        </p>
      )}
      {generation.revision_reason && (
        <p className="revision-reason">{generation.revision_reason}</p>
      )}
      {automaticChild && (
        <div className="queue-notice" role="status">
          <RefreshCw size={18} />
          <p>
            The review created version {automaticChild.version} automatically. This version remains
            saved.{" "}
            <Link className="text-link" href={`/campaigns/${id}/generations/${automaticChild.id}`}>
              View version {automaticChild.version}
            </Link>
          </p>
        </div>
      )}
      {generation.automatic_revision_stop_reason && (
        <div className="queue-notice" role="status">
          <p>{stopReasons[generation.automatic_revision_stop_reason]}</p>
        </div>
      )}
      {activeVersion && activeVersion.id !== generationId && !automaticChild && (
        <p className="phase-note">
          Another version is processing.{" "}
          <Link className="text-link" href={`/campaigns/${id}/generations/${activeVersion.id}`}>
            View version {activeVersion.version}
          </Link>
        </p>
      )}
      {generation.status === "queued" && (
        <div className="queue-notice" role="status">
          <Clock3 size={18} />
          <p>
            {job?.last_error
              ? `Retry scheduled after: ${job.last_error}`
              : "Your brief is saved in the queue. The background worker will pick it up when available."}
            {job?.last_error && (
              <>
                {" "}
                Next eligible attempt:{" "}
                {new Date(job.available_at).toLocaleString("en", { timeZone: "UTC" })} UTC.
              </>
            )}
            <span>
              {process.env.NODE_ENV === "development" && (
                <>
                  Local development: run <code>npm run worker</code> in a second terminal.{" "}
                </>
              )}
              Closing this page does not cancel the job.
            </span>
          </p>
        </div>
      )}
      {failed && (
        <div className="error-notice" role="alert">
          {job?.last_error ?? "The generation did not complete."} Any successful agent outputs are
          preserved below. A new generation will keep this version in history.
        </div>
      )}
      {ready && !approval && (
        <div className="success-notice" role="status">
          {review
            ? "Your review is saved with this version. Watch the video and inspect the feedback below. It has not been approved."
            : generation.status === "video_ready"
              ? "Your MP4 is ready to watch and download. Start a creative review below."
              : generation.status === "media_ready"
                ? "Your scene images and spoken narration are saved. Render your video below."
                : generation.status === "images_ready"
                  ? "Your storyboard images are ready. Generate your narration below."
                  : "Your script is saved. Generate images to bring the storyboard to life."}
          {generation.status === "script_ready" && !campaignActive && (
            <ImageActionButton generationId={generation.id} />
          )}
        </div>
      )}
      {partial && (
        <div className="error-notice" role="alert">
          Some media could not be completed. Successful images and audio are preserved. Review the
          errors below to retry the failed step.
        </div>
      )}
      {active && script.success && (
        <div className="queue-notice" role="status">
          <Clock3 size={18} />
          <p>
            {generation.status === "reviewing"
              ? "Reviewing your completed video and audio against the brief."
              : video
                ? "Rendering your video from the saved images and narration."
                : voiceover && scenes.every((scene) => scene.status === "succeeded")
                  ? "Creating your spoken narration. Completed scene images are saved below."
                  : "Creating your storyboard images. Each scene is processed independently; completed images appear below."}
            <span>
              Queued work continues when its worker is available. Closing this page does not cancel
              generation.
            </span>
          </p>
        </div>
      )}
      <div className="generation-layout">
        <div>
          {voiceover?.status === "succeeded" &&
            scenes.every((scene) => scene.status === "succeeded") && (
              <VideoPanel
                generationId={generationId}
                video={video}
                canStart={!campaignActive && (generation.status === "media_ready" || partial)}
              />
            )}
          {video?.status === "succeeded" && (
            <ReviewPanel
              generationId={generationId}
              review={review}
              approved={!!approval}
              task={reviewTask}
              canStart={
                !campaignActive && ["video_ready", "review_failed"].includes(generation.status)
              }
            />
          )}
          {video && review && (
            <ApprovalPanel
              generationId={generationId}
              version={generation.version}
              videoId={video.id}
              reviewId={review.id}
              score={review.overall_score}
              threshold={review.quality_threshold}
              approval={approval}
              eligible={
                video.status === "succeeded" &&
                ["awaiting_approval", "needs_revision"].includes(generation.status)
              }
              campaignActive={campaignActive}
            />
          )}
          {script.success && (
            <VoicePanel
              generationId={generationId}
              voiceover={voiceover}
              targetDuration={project.duration}
              canStart={
                !campaignActive &&
                scenes.length > 0 &&
                scenes.every((scene) => scene.status === "succeeded") &&
                (generation.status === "images_ready" || partial)
              }
            />
          )}
          <CreativeTextResults
            plan={plan.success ? plan.data : null}
            script={script.success ? script.data : null}
            scenes={scenes}
            canRetryImages={partial && !campaignActive}
            canRevise={!campaignActive && plan.success}
          />
          {!plan.success && (
            <div className="panel creative-waiting">
              <FileCheck2 size={30} />
              <h2>{failed ? "No completed plan yet" : "A clear direction comes first"}</h2>
              <p>
                {failed
                  ? "Review the saved attempt details and fix the reported issue before starting again."
                  : "The planner will establish your audience, campaign angle, hook and call to action."}
              </p>
            </div>
          )}
          {!campaignActive && script.success && plan.success && (
            <RevisionControls
              generationId={generationId}
              feedbackKey={randomUUID()}
              editKey={randomUUID()}
              script={script.data}
              duration={project.duration}
              hasReview={!!review}
            />
          )}
          <AgentAudit runs={runs} />
        </div>
        <aside>
          <Pipeline
            runs={runs}
            scenes={scenes}
            voiceover={voiceover}
            video={video}
            reviewTask={reviewTask}
            retryScheduled={generation.status === "queued"}
          />
          <section className="panel version-panel">
            <h2>Recent versions</h2>
            <nav aria-label="Generation versions">
              {versions.map((version) => (
                <Link
                  href={`/campaigns/${id}/generations/${version.id}`}
                  key={version.id}
                  className={version.id === generationId ? "version-link current" : "version-link"}
                  aria-current={version.id === generationId ? "page" : undefined}
                >
                  <span>Version {version.version}</span>
                  <small>
                    {version.overall_score !== null
                      ? `Score ${Number(version.overall_score).toFixed(1)} ? `
                      : ""}
                    {version.status.replaceAll("_", " ")} ?{" "}
                    {version.revision_mode.replaceAll("_", " ")}
                  </small>
                  <ArrowRight size={13} />
                </Link>
              ))}
            </nav>
            {versions.length === 50 && (
              <p className="phase-note">
                Showing the latest 50 versions. Older versions remain saved.
              </p>
            )}
            {!campaignActive && (
              <GenerateButton
                projectId={id}
                requestKey={randomUUID()}
                label={
                  failed && !script.success ? "Try a new generation" : "Start fresh from brief"
                }
              />
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
