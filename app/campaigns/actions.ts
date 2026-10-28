"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getSupabaseConfig } from "@/lib/env";
import { campaignFormValues, campaignSchema } from "@/lib/validation/campaign";
import type { ActionState } from "@/types/campaign";

export async function saveCampaign(
  id: string | null,
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  if (!getSupabaseConfig())
    return { message: "Connect Supabase to save campaigns. No campaign has been saved." };
  if (id && !z.uuid().safeParse(id).success) return { message: "Invalid campaign identifier." };
  const parsed = campaignSchema.safeParse(campaignFormValues(form));
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  const { supabase, user } = await requireUser();

  let savedId: string;
  try {
    const query = id
      ? supabase
          .from("projects")
          .update(parsed.data)
          .eq("id", id)
          .eq("user_id", user.id)
          .eq("status", "draft")
      : supabase.from("projects").insert({ ...parsed.data, user_id: user.id });
    const { data, error } = await query.select("id").maybeSingle();
    if (error || !data)
      return {
        message:
          "Could not save this campaign. Check your connection and migration. Only your ungenerated drafts can be edited.",
      };
    savedId = data.id;
  } catch {
    return {
      message:
        "The database is temporarily unavailable. Your brief is still here; try saving again.",
    };
  }
  revalidatePath("/");
  revalidatePath(`/campaigns/${savedId}`);
  redirect(`/campaigns/${savedId}?saved=1`);
}

export async function deleteCampaign(
  id: string,
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  if (!z.uuid().safeParse(id).success) return { message: "Invalid campaign identifier." };
  if (form.get("confirmation") !== "delete")
    return { message: "Confirm deletion before continuing." };
  const { supabase, user } = await requireUser();
  try {
    const { data, error } = await supabase
      .from("projects")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id)
      .eq("status", "draft")
      .select("id")
      .maybeSingle();
    if (error || !data)
      return {
        message: "Could not delete this campaign. Only your ungenerated drafts can be deleted.",
      };
  } catch {
    return { message: "The database is temporarily unavailable. Try again." };
  }
  revalidatePath("/");
  redirect("/?deleted=1");
}
