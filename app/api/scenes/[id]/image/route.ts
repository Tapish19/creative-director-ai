import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/env";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const failure = (message: string, status: number) =>
  Response.json({ error: message }, { status, headers });

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return failure("Invalid scene identifier.", 400);
  if (!getSupabaseConfig()) return failure("Workspace is not configured.", 503);
  try {
    const client = await createClient();
    const {
      data: { user },
      error: authError,
    } = await client.auth.getUser();
    if (authError || !user) return failure("Sign in to view this scene.", 401);
    const { data, error } = await client
      .from("scenes")
      .select("image_url,status")
      .eq("id", id)
      .maybeSingle();
    if (error) return failure("Scene preview is temporarily unavailable.", 503);
    // Both the scene lookup and Storage signing use the caller's session/RLS.
    if (!data || data.status !== "succeeded" || !data.image_url?.startsWith(`${user.id}/`))
      return failure("Scene image not found.", 404);
    const signed = await client.storage.from("creative-assets").createSignedUrl(data.image_url, 60);
    if (signed.error || !signed.data)
      return failure("Scene preview is temporarily unavailable.", 503);
    return new Response(null, {
      status: 302,
      headers: { ...headers, Location: signed.data.signedUrl },
    });
  } catch {
    return failure("Scene preview is temporarily unavailable.", 503);
  }
}
