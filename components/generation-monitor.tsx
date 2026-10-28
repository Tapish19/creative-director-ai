"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

export function GenerationMonitor({
  id,
  active,
  revision,
}: {
  id: string;
  active: boolean;
  revision: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [restart, setRestart] = useState(0);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    async function poll() {
      if (controller.signal.aborted) return;
      if (document.hidden) {
        timer = setTimeout(poll, 5_000);
        return;
      }
      try {
        const response = await fetch(`/api/generations/${id}/status`, {
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
        });
        if (response.status === 401) {
          setError("Your session expired. Sign in again to see progress.");
          return;
        }
        if (response.status === 404) {
          setError("This generation is no longer available in your workspace.");
          return;
        }
        if (!response.ok) throw new Error("Status unavailable");
        const data: unknown = await response.json();
        if (
          !data ||
          typeof data !== "object" ||
          !("revision" in data) ||
          typeof data.revision !== "string" ||
          !("active" in data) ||
          typeof data.active !== "boolean"
        )
          throw new Error("Invalid status");
        failures = 0;
        setError(null);
        if (data.revision !== revision) router.refresh();
        if (data.active) timer = setTimeout(poll, 3_000);
      } catch {
        if (controller.signal.aborted) return;
        failures += 1;
        if (failures >= 3) {
          setError(
            "Live updates paused because the connection failed. The background job continues independently.",
          );
          return;
        }
        timer = setTimeout(poll, 3_000 * failures);
      }
    }
    timer = setTimeout(poll, 1_000);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [id, active, revision, restart, router]);
  if (!active) return null;
  return (
    <div className={`generation-monitor ${error ? "has-error" : ""}`} role="status">
      {error ? (
        <>
          <span>{error}</span>
          <button
            className="text-link"
            onClick={() => {
              setError(null);
              setRestart((value) => value + 1);
              router.refresh();
            }}
          >
            <RefreshCw size={13} />
            Reconnect
          </button>
        </>
      ) : (
        <>
          <span className="live-dot" />
          <span>Live updates · You can leave this page while the worker runs.</span>
        </>
      )}
    </div>
  );
}
