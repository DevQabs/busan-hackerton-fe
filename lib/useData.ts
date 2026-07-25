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

/** 미리 받아 두는 요청은 지금 보고 있는 화면의 요청보다 뒤로 세운다 — Chrome은
 *  RequestInit.priority를 읽고, 모르는 브라우저는 이 필드를 무시한다.
 *  (lib.dom 타입에 아직 없어서 캐스팅한다.) */
const LOW_PRIORITY = { priority: "low" } as RequestInit;

function doFetch(url: string, entry: Entry, init?: RequestInit) {
  entry.status = "loading";
  fetch(url, init)
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

function getEntry(url: string, init?: RequestInit): Entry {
  let entry = cache.get(url);
  if (!entry) {
    entry = { status: "loading", listeners: new Set() };
    cache.set(url, entry);
    doFetch(url, entry, init);
  }
  return entry;
}

/** 아직 화면에 없는 페이지의 artifact를 미리 받아 캐시에 넣는다 — 그 페이지가
 *  열릴 때 useData가 곧바로 캐시를 읽는다. 이미 받은 URL은 건드리지 않고,
 *  새로 받는 것은 낮은 우선순위로 — 지금 화면의 요청을 밀어내면 안 된다. */
export function prefetchData(urls: readonly string[]) {
  urls.forEach((url) => getEntry(url, LOW_PRIORITY));
}

/** Refetch every cached artifact (본선 재적재 버튼). Old data stays on screen
 *  until the new response lands (stale-while-revalidate), so a refresh never
 *  flashes "데이터 준비 중" for panels that already had data. */
export function refreshAll() {
  cache.forEach((entry, url) => {
    if (entry.timer) window.clearTimeout(entry.timer);
    doFetch(url, entry);
  });
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
  // Keep serving the previous payload while a refreshAll() refetch is in
  // flight — only a never-fetched URL reports data: null.
  const hasData = entry !== undefined && entry.data !== undefined;
  return {
    data: hasData ? (entry.data as T) : null,
    loading: !entry || (entry.status === "loading" && !hasData),
    error: entry?.status === "error",
    retry,
  };
}
