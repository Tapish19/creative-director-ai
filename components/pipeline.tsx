import {
  AudioLines,
  Check,
  Circle,
  Clapperboard,
  Images,
  LoaderCircle,
  ScanEye,
  ScrollText,
  TriangleAlert,
  Waypoints,
} from "lucide-react";
import type { AgentRun, Scene, Voiceover, Video, ReviewTask } from "@/types/generation";
import type { AgentType } from "@/types/campaign";

const steps: Array<{
  agent: AgentType;
  title: string;
  detail: string;
  icon: typeof Waypoints;
  phase?: number;
}> = [
  { agent: "planner", title: "Planner", detail: "Audience, angle & hook", icon: Waypoints },
  {
    agent: "writer",
    title: "Script writer",
    detail: "Story, captions & scene prompts",
    icon: ScrollText,
  },
  {
    agent: "images",
    title: "Image creator",
    detail: "A visual for every scene",
    icon: Images,
  },
  {
    agent: "voice",
    title: "Voiceover",
    detail: "A voice for your story",
    icon: AudioLines,
  },
  {
    agent: "renderer",
    title: "Renderer",
    detail: "Motion, captions & a real MP4",
    icon: Clapperboard,
  },
  {
    agent: "reviewer",
    title: "AI reviewer",
    detail: "Quality scores & suggestions",
    icon: ScanEye,
  },
];

export function Pipeline({
  runs = [],
  retryScheduled = false,
  scenes = [],
  voiceover,
  video,
  reviewTask,
}: {
  runs?: AgentRun[];
  retryScheduled?: boolean;
  scenes?: Scene[];
  voiceover?: Voiceover | null;
  video?: Video | null;
  reviewTask?: ReviewTask | null;
}) {
  return (
    <section className="panel pipeline-panel">
      <div className="panel-heading">
        <div>
          <span className="section-number">
            <Check size={13} />
          </span>
          <h2>Creative workflow</h2>
        </div>
        <span className="muted small">
          {runs.length ? "Saved agent execution states" : "Generation not started"}
        </span>
      </div>
      <ol className="pipeline-list">
        {steps.map(({ agent, title, detail, icon: Icon, phase }, index) => {
          const run = runs
            .filter((item) => item.agent_type === agent)
            .sort((a, b) => b.attempt - a.attempt)[0];
          const imageStep = agent === "images" && scenes.length > 0;
          const completed = scenes.filter((scene) => scene.status === "succeeded").length;
          const imageStatus =
            completed === scenes.length
              ? "succeeded"
              : scenes.some((scene) => scene.status === "running")
                ? "running"
                : scenes.some((scene) => scene.status === "pending")
                  ? "pending"
                  : "failed";
          const status =
            agent === "reviewer" && reviewTask
              ? reviewTask.status
              : agent === "renderer" && video
                ? video.status
                : imageStep
                  ? imageStatus
                  : agent === "voice" && voiceover
                    ? voiceover.status
                    : (run?.status ?? "pending");
          const StatusIcon =
            status === "succeeded"
              ? Check
              : status === "running"
                ? LoaderCircle
                : status === "failed"
                  ? TriangleAlert
                  : Circle;
          const label =
            status === "succeeded"
              ? "Complete"
              : status === "running"
                ? "Running"
                : status === "failed"
                  ? retryScheduled
                    ? "Retry scheduled"
                    : "Failed"
                  : phase
                    ? `Phase ${phase}`
                    : "Waiting";
          return (
            <li key={agent} className={`pipeline-${status}`}>
              <div className="pipeline-icon">
                <Icon size={19} />
              </div>
              <div>
                <span className="pipeline-step">
                  STEP {String(index + 1).padStart(2, "0")}
                  {run ? ` · ATTEMPT ${run.attempt}` : ""}
                </span>
                <h3>{title}</h3>
                <p>{detail}</p>
              </div>
              <span className="pipeline-status">
                <StatusIcon size={13} className={status === "running" ? "spin" : undefined} />
                {agent === "reviewer" && reviewTask?.status === "pending"
                  ? reviewTask.error_message
                    ? "Retry scheduled"
                    : "Queued"
                  : imageStep
                    ? `${completed}/${scenes.length} · ${status === "failed" ? "Needs attention" : status === "pending" ? "Queued" : label}`
                    : agent === "renderer" && video?.status === "pending"
                      ? video.error_message
                        ? "Retry scheduled"
                        : "Queued"
                      : agent === "voice" && voiceover?.status === "pending"
                        ? voiceover.error_message
                          ? "Retry scheduled"
                          : "Queued"
                        : label}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
