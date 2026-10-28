import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/env";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const failure = (message: string, status: number) =>
  Response.json({ error: message }, { status, headers });

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return failure("Invalid generation identifier.", 400);
  if (!getSupabaseConfig()) return failure("Workspace is not configured.", 503);
  try {
    const client = await createClient();
    const {
      data: { user },
      error: authError,
    } = await client.auth.getUser();
    if (authError || !user) return failure("Sign in to listen to this voiceover.", 401);
    const { data, error } = await client
      .from("voiceovers")
      .select("audio_path,status,source_generation_id")
      .eq("generation_id", id)
      .maybeSingle();
    if (error) return failure("Voice playback is temporarily unavailable.", 503);
    if (
      !data ||
      data.status !== "succeeded" ||
      !data.audio_path?.startsWith(`${user.id}/${data.source_generation_id ?? id}/voice/`)
    )
      return failure("Voiceover not found.", 404);
    // Storage serves byte-range requests after redirect so browser seeking works.
    const signed = await client.storage
      .from("creative-assets")
      .createSignedUrl(data.audio_path, 900);
    if (signed.error || !signed.data)
      return failure("Voice playback is temporarily unavailable.", 503);
    return new Response(null, {
      status: 302,
      headers: { ...headers, Location: signed.data.signedUrl },
    });
  } catch {
    return failure("Voice playback is temporarily unavailable.", 503);
  }
}
