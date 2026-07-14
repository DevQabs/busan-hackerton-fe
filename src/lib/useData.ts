"use client";

// Shared JSON fetch hook with a module-level in-memory cache.
// Artifacts in public/data/ are produced by a separate pipeline and may not
// exist yet while the UI runs — on 404/parse error the hook reports `error`
// and silently re-polls every 8s so the dashboard picks the data up as soon
// as the pipeline writes it (no reload needed).

import { useCallback, useEffect, useState } from "react";

interface Entry {
  status: "loading" | "ok" | "error";
  data?: unknown;
  listeners: Set<() => void>;
  timer?: number;
}

const cache = new Map<string, Entry>();
const RETRY_MS = 8000;

function notify(entry: Entry) {
  entry.listeners.forEach((cb) => cb());
}

function doFetch(url: string, entry: Entry) {
  entry.status = "loading";
  fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((json) => {
      entry.status = "ok";
      entry.data = json;
      notify(entry);
    })
    .catch(() => {
      entry.status = "error";
      notify(entry);
      entry.timer = window.setTimeout(() => doFetch(url, entry), RETRY_MS);
    });
}

function getEntry(url: string): Entry {
  let entry = cache.get(url);
  if (!entry) {
    entry = { status: "loading", listeners: new Set() };
    cache.set(url, entry);
    doFetch(url, entry);
  }
  return entry;
}

export function useData<T>(url: string): {
  data: T | null;
  loading: boolean;
  error: boolean;
  retry: () => void;
} {
  const [, force] = useState(0);

  useEffect(() => {
    const entry = getEntry(url);
    const cb = () => force((n) => n + 1);
    entry.listeners.add(cb);
    // The entry may have resolved between render and effect — sync once.
    cb();
    return () => {
      entry.listeners.delete(cb);
    };
  }, [url]);

  const retry = useCallback(() => {
    const entry = cache.get(url);
    if (!entry || entry.status !== "error") return;
    if (entry.timer) window.clearTimeout(entry.timer);
    doFetch(url, entry);
    force((n) => n + 1);
  }, [url]);

  const entry = cache.get(url);
  return {
    data: entry?.status === "ok" ? (entry.data as T) : null,
    loading: !entry || entry.status === "loading",
    error: entry?.status === "error",
    retry,
  };
}
