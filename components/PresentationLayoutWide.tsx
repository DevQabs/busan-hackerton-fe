"use client";

import type { ReactNode } from "react";

// WIDE variant of PresentationLayout (지도:설명 ≈ 3:2, sideWide prop).
// 원본 PresentationLayout.tsx는 건드리지 않기 위한 분리 사본 — 2막 해운대
// 상세 페이지 전용. The reference composition for a presentation screen: ONE question, ONE map,
// 3–4 KPIs, ONE selected object, ONE recommended action. Screens hand their
// pieces in as slots instead of stacking old panels inside a narrow column.
//
//  ┌ question · story steps ──────────────────────────────┐
//  │ KPI band                                             │
//  ├──────────────────────────────┬───────────────────────┤
//  │ map (+ toolbar overlay)      │ side: one list/detail │
//  ├──────────────────────────────┴───────────────────────┤
//  │ selected object  ·  recommended action               │
//  └──────────────────────────────────────────────────────┘

export interface StoryStep {
  id: string;
  label: string;
  caption: string;
}

export function PresentationLayout({
  question,
  hint,
  steps,
  activeStep,
  onStep,
  kpis,
  toolbar,
  map,
  side,
  bottom,
  footnote,
  sideWide,
}: {
  question: string;
  hint?: string;
  steps?: StoryStep[];
  activeStep?: string;
  onStep?: (id: string) => void;
  kpis: ReactNode;
  /** Controls floating over the map's top-left (filters, toggles). */
  toolbar?: ReactNode;
  map: ReactNode;
  /** Right column: the single list or profile this step is about. */
  side: ReactNode;
  /** true = 지도:설명 ≈ 3:2 (해석을 지도와 나란히 크게 보여줄 화면용). */
  sideWide?: boolean;
  /** Full-width strip: the selected object + the recommended action. */
  bottom?: ReactNode;
  footnote?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-start gap-4 border-b border-line bg-panel/60 px-4 py-3">
        <div className="min-w-0">
          <h1 className="text-[17px] font-bold leading-6 text-ink">
            {question}
          </h1>
          {hint && (
            <p className="mt-0.5 text-[11px] leading-4 text-dim">{hint}</p>
          )}
        </div>

        {steps && steps.length > 0 && (
          <ol className="ml-auto flex shrink-0 items-stretch gap-1.5">
            {steps.map((step, i) => {
              const active = step.id === activeStep;
              return (
                <li key={step.id} className="flex items-center gap-1.5">
                  {i > 0 && (
                    <span aria-hidden className="text-[11px] text-dim">
                      →
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => onStep?.(step.id)}
                    aria-current={active ? "step" : undefined}
                    className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors ${
                      active
                        ? "border-accent/60 bg-accent/10"
                        : "border-line bg-panel hover:bg-[#161e30]"
                    }`}
                  >
                    <span
                      className={`tnum flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold ${
                        active
                          ? "bg-accent/20 text-accent"
                          : "bg-[#0e1424] text-dim"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0">
                      <span
                        className={`block text-[12px] font-semibold leading-4 ${
                          active ? "text-accent" : "text-ink/80"
                        }`}
                      >
                        {step.label}
                      </span>
                      <span className="block text-[10px] leading-4 text-dim">
                        {step.caption}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </header>

      <div className="shrink-0 border-b border-line bg-bg px-4 py-3">
        {kpis}
      </div>

      <div className="flex min-h-0 flex-1">
        <section className="relative min-w-0 flex-1">
          {map}
          {toolbar && (
            <div className="absolute left-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-col items-start gap-2">
              {toolbar}
            </div>
          )}
        </section>

        <aside
          className={`flex shrink-0 flex-col overflow-y-auto border-l border-line bg-bg p-3 ${
            sideWide ? "w-[40%] min-w-[340px] max-w-[600px]" : "w-[360px]"
          }`}
        >
          {side}
        </aside>
      </div>

      {bottom && (
        <div className="shrink-0 border-t border-line bg-panel/60 px-4 py-3">
          {bottom}
        </div>
      )}

      {footnote && (
        <div className="shrink-0 border-t border-line bg-bg px-4 py-1.5 text-[10px] leading-4 text-dim">
          {footnote}
        </div>
      )}
    </div>
  );
}

/** Compact KPI tile for the band — 3–4 per screen, no more. */
export function KpiTile({
  label,
  value,
  sub,
  color,
  active,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  active?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border px-3.5 py-2.5 ${
        active ? "border-accent/50 bg-accent/[0.06]" : "border-line bg-panel"
      }`}
    >
      <div
        className="mb-1.5 h-0.5 w-6 rounded-full"
        style={{ background: color ?? "var(--accent)" }}
      />
      <div className="truncate text-[11px] leading-4 text-dim">{label}</div>
      <div className="tnum mt-0.5 truncate text-[20px] font-bold leading-7 text-ink">
        {value}
      </div>
      <div className="tnum truncate text-[10.5px] leading-4 text-dim">
        {sub ?? " "}
      </div>
    </div>
  );
}

/** Floating map control group (filter chips, toggles). */
export function MapToolbar({
  label,
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-line bg-panel/92 px-2.5 py-2 backdrop-blur">
      {label && (
        <div className="mb-1.5 text-[10px] font-semibold leading-4 text-dim">
          {label}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

export function Chip({
  active,
  onClick,
  children,
  color,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  color?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
        active
          ? "border-accent/60 bg-accent/15 text-accent"
          : "border-line bg-panel text-dim hover:text-ink"
      }`}
    >
      {color && (
        <span
          className="h-2 w-2 rounded-full"
          style={{ background: color, opacity: active ? 1 : 0.45 }}
        />
      )}
      {children}
    </button>
  );
}

/** The one recommended action of the screen — always the rightmost block of
 *  the bottom strip so the eye lands on "what to do" last. */
export function ActionCard({
  eyebrow,
  action,
  owner,
  impact,
  cta,
}: {
  eyebrow: string;
  action: string;
  owner?: string;
  impact?: string;
  cta?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex min-w-[260px] flex-col gap-1 rounded-lg border border-accent/40 bg-accent/[0.06] px-3.5 py-2.5">
      <div className="text-[10px] font-semibold leading-4 text-accent">
        {eyebrow}
      </div>
      <div className="text-[13px] font-bold leading-5 text-ink">{action}</div>
      <div className="flex items-center gap-2 text-[10.5px] leading-4 text-dim">
        {owner && (
          <span className="rounded border border-line bg-[#0e1424] px-1.5 py-px text-ink/80">
            소관 {owner}
          </span>
        )}
        {impact && <span>{impact}</span>}
      </div>
      {cta && (
        <button
          type="button"
          onClick={cta.onClick}
          className="mt-0.5 self-start rounded-md border border-accent/50 bg-accent/10 px-2.5 py-1 text-[11px] font-semibold text-accent hover:bg-accent/20"
        >
          {cta.label}
        </button>
      )}
    </div>
  );
}
