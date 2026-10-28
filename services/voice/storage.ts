import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { VoiceError } from "./errors";
export interface VoiceStorage {
  upload(path: string, data: Uint8Array): Promise<void>;
}
export class SupabaseVoiceStorage implements VoiceStorage {
  constructor(private readonly client: SupabaseClient<Database>) {}
  async upload(path: string, data: Uint8Array) {
    const { error } = await this.client.storage
      .from("creative-assets")
      .upload(path, data, { contentType: "audio/wav", cacheControl: "3600", upsert: false });
    if (error)
      throw new VoiceError("storage", "The voiceover could not be saved to private storage.", true);
  }
}
