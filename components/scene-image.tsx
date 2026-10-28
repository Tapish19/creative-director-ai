"use client";
import Image from "next/image";
import { useState } from "react";
import { ImageOff } from "lucide-react";

export function SceneImage({
  id,
  caption,
  attempt,
}: {
  id: string;
  caption: string;
  attempt: number;
}) {
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  return (
    <div className="scene-image">
      {failed ? (
        <div className="preview-error" role="status">
          <ImageOff size={24} />
          <p>Preview unavailable. Your saved image is preserved.</p>
          <button
            className="button secondary"
            onClick={() => {
              setReload((value) => value + 1);
              setFailed(false);
            }}
          >
            Reload preview
          </button>
        </div>
      ) : (
        <Image
          src={`/api/scenes/${id}/image?v=${attempt}&reload=${reload}`}
          alt={caption}
          width={720}
          height={1280}
          unoptimized
          onError={() => setFailed(true)}
        />
      )}
      <span className="image-origin">AI generated · 9:16</span>
    </div>
  );
}
