"use client";

import { useState, type ReactNode } from "react";

/** Collapsible Korean explainer for analytical scenes.
 *  Three fixed sections so a non-statistician judge can follow:
 *  무엇을 보여주나 / 어떻게 계산했나 / 주의할 점. */
export function Explainer({
  what,
  how,
  caveats,
  defaultOpen = false,
}: {
  what: ReactNode;
  how: ReactNode;
  caveats: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="rounded-lg border border-line bg-panel">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3.5 py-2.5 text-left"
      >
        <span className="flex items-center gap-2 text-[12px] font-semibold tracking-wide text-ink">
          <span className="flex h-4 w-4 items-center justify-center rounded-full border border-accent/50 text-[10px] font-bold text-accent">
            ?
          </span>
          이 화면 읽는 법
        </span>
        <span className="text-[11px] text-dim">{open ? "접기" : "펼치기"}</span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-line px-3.5 py-3">
          <ExplainerBlock label="무엇을 보여주나">{what}</ExplainerBlock>
          <ExplainerBlock label="어떻게 계산했나">{how}</ExplainerBlock>
          <ExplainerBlock label="주의할 점">{caveats}</ExplainerBlock>
        </div>
      )}
    </section>
  );
}

function ExplainerBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold text-accent">{label}</div>
      <div className="text-[12px] leading-5 text-ink/80">{children}</div>
    </div>
  );
}
