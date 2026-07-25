"use client";

// 출발지/도착지 입력 — 카카오 로컬 검색(서버 프록시 경유) 자동완성.
// Debounced so typing an apartment name does not fire a request per keystroke.

import { useEffect, useRef, useState } from "react";
import { searchPlaces, type KakaoPlace } from "@/lib/kakao";

const DEBOUNCE_MS = 320;

export function PlaceInput({
  label,
  placeholder,
  value,
  onPick,
  onClear,
  accentHex,
}: {
  label: string;
  placeholder: string;
  value: KakaoPlace | null;
  onPick: (p: KakaoPlace) => void;
  onClear: () => void;
  accentHex: string;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<KakaoPlace[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  // Guards against an earlier, slower response overwriting a newer one.
  const seqRef = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setErr(null);
      setBusy(false);
      return;
    }
    const seq = ++seqRef.current;
    setBusy(true);
    const timer = window.setTimeout(async () => {
      try {
        const found = await searchPlaces(q);
        if (seq !== seqRef.current) return;
        setHits(found);
        setErr(found.length === 0 ? "검색 결과가 없습니다" : null);
        setOpen(true);
      } catch (e) {
        if (seq !== seqRef.current) return;
        setHits([]);
        setErr(e instanceof Error ? e.message : "검색에 실패했습니다");
        setOpen(true);
      } finally {
        if (seq === seqRef.current) setBusy(false);
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  // Click-away closes the suggestion list.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const pick = (p: KakaoPlace) => {
    onPick(p);
    setQuery("");
    setHits([]);
    setOpen(false);
    setErr(null);
  };

  return (
    <div ref={boxRef} className="relative">
      <label className="mb-1 flex items-center gap-1.5 text-[11px] text-dim">
        <span
          className="h-2 w-2 rounded-full"
          style={{ background: accentHex }}
          aria-hidden
        />
        {label}
      </label>

      {value ? (
        <div className="flex items-start gap-2 rounded-lg border border-line bg-panel px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium">{value.name}</p>
            {value.address && (
              <p className="truncate text-[11px] text-dim">{value.address}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClear}
            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-dim transition-colors hover:bg-line hover:text-ink"
          >
            변경
          </button>
        </div>
      ) : (
        <>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => hits.length > 0 && setOpen(true)}
            placeholder={placeholder}
            inputMode="search"
            autoComplete="off"
            className="w-full rounded-lg border border-line bg-panel px-3 py-2 text-[13px] outline-none transition-colors placeholder:text-dim/70 focus:border-accent"
          />
          {busy && (
            <span className="absolute right-3 top-[30px] text-[11px] text-dim">
              검색 중…
            </span>
          )}
        </>
      )}

      {open && !value && (hits.length > 0 || err) && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-line bg-panel shadow-lg">
          {err && hits.length === 0 ? (
            <li className="px-3 py-2 text-[12px] text-dim">{err}</li>
          ) : (
            hits.map((p, i) => (
              <li key={`${p.name}-${p.coord[0]}-${p.coord[1]}-${i}`}>
                <button
                  type="button"
                  onClick={() => pick(p)}
                  className="w-full px-3 py-2 text-left transition-colors hover:bg-line"
                >
                  <span className="block truncate text-[13px]">{p.name}</span>
                  {p.address && (
                    <span className="block truncate text-[11px] text-dim">
                      {p.address}
                    </span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
