"use client";
import { useActionState, useState, useId } from "react";
import { RefreshCw, Pencil, Plus, Trash2, LoaderCircle } from "lucide-react";
import { createRevision, type RevisionActionState } from "@/app/campaigns/revision-actions";
import { editedScript } from "@/types/revision";
import type { CreativeScript, CreativeScene } from "@/types/creative";
const initial: RevisionActionState = {};
function Errors({ state }: { state: RevisionActionState }) {
  return state.message ? (
    <div className="field-error" role="alert">
      <p>{state.message}</p>
      {state.issues && (
        <ul>
          {state.issues.map((issue, index) => (
            <li key={index}>{issue}</li>
          ))}
        </ul>
      )}
    </div>
  ) : null;
}
function Submit({ pending, label }: { pending: boolean; label: string }) {
  return (
    <button className="button primary" disabled={pending}>
      {pending ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}{" "}
      {pending ? "Creating version…" : label}
    </button>
  );
}
export function RevisionControls({
  generationId,
  feedbackKey,
  editKey,
  script,
  duration,
  hasReview,
}: {
  generationId: string;
  feedbackKey: string;
  editKey: string;
  script: CreativeScript;
  duration: 15 | 30;
  hasReview: boolean;
}) {
  const [state, action, pending] = useActionState(
    createRevision.bind(null, generationId, feedbackKey),
    initial,
  );
  const [instruction, setInstruction] = useState("");
  const id = useId();
  return (
    <section className="panel result-panel revision-panel">
      <div className="panel-heading">
        <div>
          <RefreshCw size={18} />
          <h2>Take another direction</h2>
        </div>
        <span className="result-tag">New version</span>
      </div>
      <p>
        {hasReview
          ? "Regenerate with the saved review feedback and any direction you add below."
          : "Regenerate from the saved brief and script, with any direction you add below."}{" "}
        This keeps the current version intact.
      </p>
      <form action={action} className="revision-form">
        <label htmlFor={id}>
          Additional direction <span className="muted">(optional)</span>
        </label>
        <textarea
          id={id}
          disabled={pending}
          rows={3}
          maxLength={2000}
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder="Make the opening more specific to independent hotel owners…"
        />
        <input
          type="hidden"
          name="payload"
          value={JSON.stringify({ mode: "feedback", instruction })}
        />
        <Submit pending={pending} label="Regenerate" />
        <Errors state={state} />
      </form>
      <details className="script-editor-details">
        <summary>
          <Pencil size={15} /> Edit script
        </summary>
        <ScriptEditor
          generationId={generationId}
          requestKey={editKey}
          script={script}
          duration={duration}
        />
      </details>
    </section>
  );
}
export function ScriptEditor({
  generationId,
  requestKey,
  script,
  duration,
}: {
  generationId: string;
  requestKey: string;
  script: CreativeScript;
  duration: 15 | 30;
}) {
  const [state, action, pending] = useActionState(
    createRevision.bind(null, generationId, requestKey),
    initial,
  );
  const [scenes, setScenes] = useState(script.scenes);
  const prefix = useId();
  const change = (index: number, field: keyof CreativeScene, value: string | number) =>
    setScenes((current) =>
      current.map((scene, position) => (position === index ? { ...scene, [field]: value } : scene)),
    );
  const total = scenes.reduce((sum, scene) => sum + scene.duration, 0);
  let issue: string | null = null;
  try {
    editedScript(scenes, duration);
  } catch (error) {
    issue =
      error instanceof Error && "issues" in error
        ? "Check scene lengths and copy. Total duration must match the brief, and narration must fit each scene."
        : "Check the edited script.";
  }
  return (
    <form action={action} className="revision-form script-editor">
      <p>
        Edit narration, captions, timing or visual direction. Unchanged images and narration are
        reused. The new version is rendered and reviewed; automatic rewrites are off for this edit.
      </p>
      <fieldset disabled={pending}>
        {scenes.map((scene, index) => (
          <div className="edit-scene" key={index}>
            <div className="scene-heading">
              <h3>Scene {index + 1}</h3>
              {scenes.length > 3 && (
                <button
                  type="button"
                  className="text-link"
                  aria-label={`Remove scene ${index + 1}`}
                  onClick={() =>
                    setScenes((current) =>
                      current
                        .filter((_, position) => position !== index)
                        .map((item, position) => ({ ...item, sceneNumber: position + 1 })),
                    )
                  }
                >
                  <Trash2 size={14} />
                  Remove
                </button>
              )}
            </div>
            <label htmlFor={`${prefix}-${index}-duration`}>Duration (seconds)</label>
            <input
              id={`${prefix}-${index}-duration`}
              type="number"
              min="0.1"
              max="30"
              step="0.1"
              value={scene.duration}
              onChange={(event) => change(index, "duration", Number(event.target.value))}
            />
            <label htmlFor={`${prefix}-${index}-voice`}>Narration</label>
            <textarea
              id={`${prefix}-${index}-voice`}
              required
              maxLength={1000}
              rows={2}
              value={scene.voiceover}
              onChange={(event) => change(index, "voiceover", event.target.value)}
            />
            <label htmlFor={`${prefix}-${index}-caption`}>Caption</label>
            <input
              id={`${prefix}-${index}-caption`}
              required
              maxLength={80}
              value={scene.caption}
              onChange={(event) => change(index, "caption", event.target.value)}
            />
            <label htmlFor={`${prefix}-${index}-visual`}>Visual prompt</label>
            <textarea
              id={`${prefix}-${index}-visual`}
              required
              minLength={20}
              maxLength={3000}
              rows={3}
              value={scene.visualPrompt}
              onChange={(event) => change(index, "visualPrompt", event.target.value)}
            />
          </div>
        ))}
      </fieldset>
      {scenes.length < 5 && (
        <button
          type="button"
          className="button secondary"
          disabled={pending}
          onClick={() =>
            setScenes((current) => [
              ...current,
              {
                sceneNumber: current.length + 1,
                duration: 3,
                voiceover: "",
                caption: "",
                visualPrompt: "",
              },
            ])
          }
        >
          <Plus size={14} />
          Add scene
        </button>
      )}
      <p className={issue ? "field-error" : "muted"} role="status">
        {Number(total.toFixed(2))} / {duration} seconds{issue ? ` · ${issue}` : ""}
      </p>
      <input type="hidden" name="payload" value={JSON.stringify({ mode: "script_edit", scenes })} />
      <Submit pending={pending} label="Save as new version" />
      <Errors state={state} />
    </form>
  );
}
export function RegenerateScene({
  generationId,
  sceneId,
  requestKey,
  prompt,
  sceneNumber,
}: {
  generationId: string;
  sceneId: string;
  requestKey: string;
  prompt: string;
  sceneNumber: number;
}) {
  const [state, action, pending] = useActionState(
    createRevision.bind(null, generationId, requestKey),
    initial,
  );
  const [visualPrompt, setPrompt] = useState(prompt);
  const id = useId();
  return (
    <details className="scene-regenerate">
      <summary>
        <RefreshCw size={14} />
        Regenerate scene {sceneNumber}
      </summary>
      <form action={action} className="revision-form">
        <p>
          Creates a new version with this image regenerated. Other images and unchanged narration
          are reused. Automatic rewrites are off for this version.
        </p>
        <label htmlFor={id}>Visual direction</label>
        <textarea
          id={id}
          disabled={pending}
          required
          minLength={20}
          maxLength={3000}
          rows={5}
          value={visualPrompt}
          onChange={(event) => setPrompt(event.target.value)}
        />
        <input
          type="hidden"
          name="payload"
          value={JSON.stringify({ mode: "scene", sceneId, visualPrompt })}
        />
        <Submit pending={pending} label="Regenerate scene" />
        <Errors state={state} />
      </form>
    </details>
  );
}
