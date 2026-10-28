import clsx from "clsx";
import type { ProjectStatus } from "@/types/campaign";

const labels: Record<ProjectStatus, string> = {
  draft: "Draft",
  queued: "Queued",
  generating: "Generating",
  script_ready: "Script ready",
  images_ready: "Images ready",
  media_ready: "Images & voice ready",
  video_ready: "Video ready",
  needs_revision: "Needs revision",
  review_failed: "Review needs attention",
  partial: "Partial generation",
  awaiting_approval: "Needs approval",
  approved: "Approved",
  failed: "Needs attention",
};

export function StatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <span className={clsx("status-badge", `status-${status}`)}>
      <span />
      {labels[status]}
    </span>
  );
}
