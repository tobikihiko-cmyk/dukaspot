"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

type ApiState = "checking" | "ok" | "down";

export function ApiHealthPill() {
  const [state, setState] = useState<ApiState>("checking");

  async function checkHealth() {
    setState("checking");
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      setState(response.ok ? "ok" : "down");
    } catch {
      setState("down");
    }
  }

  useEffect(() => {
    void checkHealth();
  }, []);

  return (
    <button
      type="button"
      onClick={() => void checkHealth()}
      className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-emerald-700/15"
      aria-label="Refresh API health"
    >
      <span
        className={[
          "h-2.5 w-2.5 rounded-full",
          state === "ok" ? "bg-emerald-600" : "",
          state === "down" ? "bg-rose-600" : "",
          state === "checking" ? "bg-amber-500" : "",
        ].join(" ")}
      />
      <span>{state === "ok" ? "API online" : state === "down" ? "API offline" : "Checking API"}</span>
      <RefreshCw className={["h-4 w-4", state === "checking" ? "animate-spin" : ""].join(" ")} />
    </button>
  );
}
