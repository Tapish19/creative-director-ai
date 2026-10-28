"use client";
import { useActionState } from "react";
import { Images, LoaderCircle } from "lucide-react";
import { enqueueImages } from "@/app/campaigns/image-actions";
import type { ActionState } from "@/types/campaign";

export function ImageActionButton({
  generationId,
  sceneId,
}: {
  generationId: string;
  sceneId?: string;
}) {
  const [state, action, pending] = useActionState(
    enqueueImages.bind(null, generationId, sceneId),
    {} as ActionState,
  );
  return (
    <form action={action} className="generate-form">
      <button className="button secondary" disabled={pending}>
        {pending ? <LoaderCircle size={15} className="spin" /> : <Images size={15} />}
        {pending ? "Queuing…" : sceneId ? "Retry this image" : "Generate scene images"}
      </button>
      {state.message && (
        <p className="field-error" role="alert">
          {state.message}
        </p>
      )}
    </form>
  );
}
