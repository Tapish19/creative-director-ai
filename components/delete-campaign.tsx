"use client";

import { useActionState, useState } from "react";
import { LoaderCircle, Trash2 } from "lucide-react";
import { deleteCampaign } from "@/app/campaigns/actions";
import type { ActionState } from "@/types/campaign";

export function DeleteCampaign({ id }: { id: string }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(deleteCampaign.bind(null, id), {} as ActionState);
  if (!confirming)
    return (
      <button className="button danger-ghost" onClick={() => setConfirming(true)}>
        <Trash2 size={15} />
        Delete draft
      </button>
    );
  return (
    <form action={action} className="delete-confirmation">
      <p>Delete this campaign? This permanently removes the brief.</p>
      <input type="hidden" name="confirmation" value="delete" />
      <div>
        <button className="button danger" disabled={pending}>
          {pending ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}Delete
          permanently
        </button>
        <button
          className="button secondary"
          type="button"
          disabled={pending}
          onClick={() => setConfirming(false)}
        >
          Keep campaign
        </button>
      </div>
      {state.message && (
        <p className="field-error" role="alert">
          {state.message}
        </p>
      )}
    </form>
  );
}
