"use client";
import { useActionState } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";
import { startTextGeneration } from "@/app/campaigns/generation-actions";
import type { ActionState } from "@/types/campaign";

export function GenerateButton({
  projectId,
  requestKey,
  label = "Generate storyboard",
}: {
  projectId: string;
  requestKey: string;
  label?: string;
}) {
  const [state, action, pending] = useActionState(
    startTextGeneration.bind(null, projectId, requestKey),
    {} as ActionState,
  );
  return (
    <form action={action} className="generate-form">
      <button className="button primary" disabled={pending}>
        {pending ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />}
        {pending ? "Queuing…" : label}
      </button>
      {state.message && (
        <p className="field-error" role="alert">
          {state.message}
        </p>
      )}
    </form>
  );
}
