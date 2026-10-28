import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { RenderError } from "./errors";
export interface RenderStorage {
  download(path: string, maxBytes: number): Promise<Uint8Array>;
  upload(path: string, data: Uint8Array): Promise<void>;
}
export class SupabaseRenderStorage implements RenderStorage {
  constructor(private readonly client: SupabaseClient<Database>) {}
  async download(path: string, maxBytes: number) {
    const { data, error } = await this.client.storage.from("creative-assets").download(path);
    if (error || !data)
      throw new RenderError(
        "storage",
        "A saved render input could not be downloaded from private storage.",
        true,
      );
    if (data.size > maxBytes || !data.size)
      throw new RenderError(
        "invalid_input",
        "A saved render input is empty or exceeds its size limit.",
        false,
      );
    return new Uint8Array(await data.arrayBuffer());
  }
  async upload(path: string, data: Uint8Array) {
    const { error } = await this.client.storage
      .from("creative-assets")
      .upload(path, data, { contentType: "video/mp4", cacheControl: "3600", upsert: false });
    if (error)
      throw new RenderError(
        "storage",
        "The rendered MP4 could not be saved to private storage.",
        true,
      );
  }
}
