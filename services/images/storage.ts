import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { ImageError } from "./errors";

export interface ImageStorage {
  upload(path: string, data: Uint8Array): Promise<void>;
}

export class SupabaseImageStorage implements ImageStorage {
  constructor(private readonly client: SupabaseClient<Database>) {}
  async upload(path: string, data: Uint8Array) {
    const { error } = await this.client.storage.from("creative-assets").upload(path, data, {
      contentType: "image/jpeg",
      cacheControl: "3600",
      upsert: false,
    });
    if (error)
      throw new ImageError(
        "storage",
        "The scene image could not be saved to private storage.",
        true,
      );
  }
}
