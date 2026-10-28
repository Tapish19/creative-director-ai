"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getSupabaseConfig } from "@/lib/env";
import { revisionRequestSchema, editedScript } from "@/types/revision";
import type { Json } from "@/types/database";
export type RevisionActionState = { message?: string; issues?: string[] };
export async function createRevision(
  parentId: string,
  requestKey: string,
  _previous: RevisionActionState,
  form: FormData,
): Promise<RevisionActionState> {
  if (!getSupabaseConfig()) return { message: "Connect Supabase before creating a revision." };
  if (!z.uuid().safeParse(parentId).success || !z.uuid().safeParse(requestKey).success)
    return { message: "Invalid revision request. Refresh and try again." };
  const { supabase } = await requireUser();
  let destination: string;
  try {
    const raw = form.get("payload");
    if (typeof raw !== "string" || raw.length > 65536)
      return { message: "The revision form is missing or too large." };
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      return { message: "The revision form is invalid. Refresh and try again." };
    }
    const parsed = revisionRequestSchema.safeParse(decoded);
    if (!parsed.success)
      return {
        message: "Check the revision fields.",
        issues: parsed.error.issues
          .slice(0, 12)
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      };
    const { data: parent, error: readError } = await supabase
      .from("generations")
      .select("project_id,brief_snapshot")
      .eq("id", parentId)
      .maybeSingle();
    if (readError || !parent) return { message: "This generation is unavailable." };
    const brief = z
      .object({ duration: z.union([z.literal(15), z.literal(30)]) })
      .safeParse(parent.brief_snapshot);
    if (!brief.success)
      return { message: "The saved duration is invalid. Create a corrected campaign." };
    const request = parsed.data;
    const script =
      request.mode === "script_edit" ? editedScript(request.scenes, brief.data.duration) : null;
    const { data, error } = await supabase.rpc("enqueue_revision", {
      p_parent_id: parentId,
      p_request_key: requestKey,
      p_mode: request.mode,
      p_instruction: request.mode === "feedback" ? request.instruction : "",
      p_script: script as Json | null,
      p_scene_id: request.mode === "scene" ? request.sceneId : null,
      p_visual_prompt: request.mode === "scene" ? request.visualPrompt : null,
    });
    if (error || !data)
      return {
        message:
          error?.code === "55000"
            ? "Wait for the active version to finish before revising. The source must have a saved script."
            : error?.code === "P0001"
              ? "Generation limit reached: 3 active campaigns and 20 new versions per account in 24 hours."
              : error?.code === "22023"
                ? "The edited script or scene did not pass validation. Check durations, narration and visual prompts."
                : "Could not create the revision. Check your connection and Phase 7 migration.",
      };
    destination = `/campaigns/${parent.project_id}/generations/${data}`;
  } catch (error) {
    if (error instanceof z.ZodError)
      return {
        message: "Check the edited script timing and narration.",
        issues: error.issues
          .slice(0, 12)
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      };
    return {
      message:
        "The revision could not be confirmed. Retry the same request to avoid creating a duplicate version.",
    };
  }
  revalidatePath("/", "layout");
  redirect(destination);
}
