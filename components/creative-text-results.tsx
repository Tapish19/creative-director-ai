import { randomUUID } from "node:crypto";
import { RegenerateScene } from "./revision-controls";
import { FileText, ImageIcon, Target } from "lucide-react";
import type { CreativePlan, CreativeScript } from "@/types/creative";
import type { AgentRun, Scene } from "@/types/generation";
import { SceneImage } from "./scene-image";
import { ImageActionButton } from "./image-action-button";

export function CreativeTextResults({
  plan,
  script,
  scenes = [],
  canRetryImages = false,
  canRevise = false,
}: {
  plan: CreativePlan | null;
  script: CreativeScript | null;
  scenes?: Scene[];
  canRetryImages?: boolean;
  canRevise?: boolean;
}) {
  return (
    <>
      {plan && (
        <section className="panel result-panel">
          <div className="panel-heading">
            <div>
              <Target size={18} />
              <h2>Creative direction</h2>
            </div>
            <span className="result-tag">Planner output</span>
          </div>
          <h3 className="campaign-angle">{plan.campaignAngle}</h3>
          <dl className="direction-grid">
            <div>
              <dt>Audience</dt>
              <dd>{plan.targetAudience}</dd>
            </div>
            <div>
              <dt>Opening hook</dt>
              <dd>{plan.hook}</dd>
            </div>
            <div>
              <dt>Call to action</dt>
              <dd>{plan.cta}</dd>
            </div>
            <div>
              <dt>Pain points</dt>
              <dd>
                <ul>
                  {plan.painPoints.map((point, index) => (
                    <li key={index}>{point}</li>
                  ))}
                </ul>
              </dd>
            </div>
          </dl>
        </section>
      )}
      {script && (
        <>
          <section className="panel result-panel">
            <div className="panel-heading">
              <div>
                <FileText size={18} />
                <h2>The script</h2>
              </div>
              <span className="result-tag">Saved script</span>
            </div>
            <p className="script-copy">{script.script}</p>
            <div className="voiceover-copy">
              <span className="eyebrow">FULL VOICEOVER</span>
              <p>{script.voiceover}</p>
              <small>Transcript for the generated voiceover.</small>
            </div>
          </section>
          <section className="storyboard-section">
            <div className="section-heading">
              <div className="section-title">
                <h2>Scene storyboard</h2>
                <span className="count-badge">{script.scenes.length}</span>
              </div>
              <span className="muted small">
                {script.scenes.reduce((total, scene) => total + scene.duration, 0)} seconds total
              </span>
            </div>
            <div className="storyboard-grid">
              {script.scenes.map((scene) => {
                const saved = scenes.find((item) => item.scene_number === scene.sceneNumber);
                return (
                  <article className="panel scene-card" key={scene.sceneNumber}>
                    {saved?.status === "succeeded" && saved.image_url ? (
                      <SceneImage id={saved.id} caption={scene.caption} attempt={saved.attempts} />
                    ) : (
                      <div className="scene-placeholder">
                        <ImageIcon size={26} />
                        <span>
                          {saved?.status === "running"
                            ? "Creating scene image…"
                            : saved?.status === "failed"
                              ? "Image needs attention"
                              : saved?.error_message
                                ? "Image retry scheduled"
                                : "Image waiting in queue"}
                        </span>
                        <strong>{String(scene.sceneNumber).padStart(2, "0")}</strong>
                      </div>
                    )}
                    <div className="scene-body">
                      <div className="scene-heading">
                        <h3>Scene {scene.sceneNumber}</h3>
                        <span>{scene.duration}s</span>
                      </div>
                      <p className="scene-caption">{scene.caption}</p>
                      <p className="scene-narration">{scene.voiceover}</p>
                      {saved && (
                        <p className="scene-image-status">
                          Image: {saved.source_scene_id ? "reused" : saved.status} ·{" "}
                          {saved.attempts} attempt
                          {saved.attempts === 1 ? "" : "s"}
                        </p>
                      )}
                      {saved?.error_message && <p className="field-error">{saved.error_message}</p>}
                      {saved?.status === "failed" &&
                        (canRetryImages && saved.retry_count < 2 ? (
                          <ImageActionButton
                            generationId={saved.generation_id}
                            sceneId={saved.id}
                          />
                        ) : (
                          <p className="phase-note">
                            {saved.retry_count >= 2
                              ? "Retry limit reached for this scene. Start a new version after resolving the issue."
                              : "Other images are still processing. You can retry this scene when the batch finishes."}
                          </p>
                        ))}
                      {canRevise && saved && (
                        <RegenerateScene
                          generationId={saved.generation_id}
                          sceneId={saved.id}
                          requestKey={randomUUID()}
                          prompt={scene.visualPrompt}
                          sceneNumber={scene.sceneNumber}
                        />
                      )}
                      <details>
                        <summary>Visual prompt</summary>
                        <p>{scene.visualPrompt}</p>
                      </details>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </>
      )}
    </>
  );
}

export function AgentAudit({ runs }: { runs: AgentRun[] }) {
  if (!runs.length) return null;
  return (
    <details className="panel agent-audit">
      <summary>
        Agent execution log <span>{runs.length} saved attempts</span>
      </summary>
      <p className="audit-intro">
        Prompts, structured outputs, timing and provider details for this version.
      </p>
      {runs.map((run) => (
        <details className="audit-attempt" key={run.id}>
          <summary>
            <strong>
              {
                {
                  planner: "Planner",
                  writer: "Script writer",
                  images: "Image creator",
                  voice: "Voiceover",
                  renderer: "Renderer",
                  reviewer: "AI reviewer",
                }[run.agent_type]
              }{" "}
              · Attempt {run.attempt}
            </strong>
            <span>
              {run.status}
              {run.execution_time !== null ? ` · ${(run.execution_time / 1000).toFixed(1)}s` : ""}
            </span>
          </summary>
          <p className="audit-provider">
            {run.provider} / {run.model}
          </p>
          {run.error_message && <p className="field-error">{run.error_message}</p>}
          <h4>Input</h4>
          <pre>{JSON.stringify(run.input, null, 2)}</pre>
          <h4>Output</h4>
          <pre>{JSON.stringify(run.output, null, 2)}</pre>
          {run.usage && (
            <>
              <h4>Token usage</h4>
              <pre>{JSON.stringify(run.usage, null, 2)}</pre>
            </>
          )}
        </details>
      ))}
    </details>
  );
}
