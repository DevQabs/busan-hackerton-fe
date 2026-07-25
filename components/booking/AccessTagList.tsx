"use client";

// 무장애가게 12항목 태그 + 종합 verdict 배지.
//
// The verdict comes from lib/access.ts (statusOf) so this card can never
// disagree with the 접근성 사각지대 / Last400 scenes. Tags render all 12 audited
// fields — including the ones that FAILED — because hiding the gaps is exactly
// what a 교통약자 planning a trip cannot afford.

import { CLS_HEX, actionOf, type AccessStatus } from "@/lib/access";
import { accessTags } from "@/lib/proximity";

const VERDICT_LABEL: Record<AccessStatus["cls"], string> = {
  good: "완비",
  warning: "진입 가능 · 미완비",
  critical: "진입 불가",
};

export function VerdictBadge({ status }: { status: AccessStatus }) {
  const hex = CLS_HEX[status.cls];
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium lg:px-2 lg:py-0.5 lg:text-[11px]"
      style={{ background: `${hex}22`, color: hex, border: `1px solid ${hex}55` }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: hex }}
        aria-hidden
      />
      {VERDICT_LABEL[status.cls]}
    </span>
  );
}

/** The chain read out in words: 진입 → 이용 → 편의, with the first break named. */
export function ChainLine({ status }: { status: AccessStatus }) {
  const steps: { label: string; ok: boolean }[] = [
    { label: "진입", ok: status.enterable },
    { label: "이용", ok: status.usable },
    { label: "편의", ok: status.comfort },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px] lg:text-[11px]">
      {steps.map((s, i) => (
        <span key={s.label} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-dim">→</span>}
          <span style={{ color: s.ok ? CLS_HEX.good : CLS_HEX.critical }}>
            {s.ok ? "✓" : "✕"} {s.label}
          </span>
        </span>
      ))}
      {status.barrier !== "완비" && (
        <span className="text-dim">· 막히는 지점: {status.barrier}</span>
      )}
    </div>
  );
}

export function AccessTagList({
  fields,
}: {
  fields: Record<string, "Y" | "N">;
}) {
  const tags = accessTags(fields);
  return (
    <ul className="flex flex-wrap gap-1">
      {tags.map((t) => {
        const hex = t.good ? CLS_HEX.good : CLS_HEX.critical;
        return (
          <li
            key={t.key}
            className="tnum rounded px-2 py-1 text-[11.5px] leading-tight lg:px-1.5 lg:py-0.5 lg:text-[10px]"
            style={{
              background: `${hex}1a`,
              color: hex,
              border: `1px solid ${hex}40`,
            }}
            // 입구턱="Y" is a barrier present, so the ✕ is correct even though
            // the raw value is Y — spell it out for anyone reading the tag.
            title={`실사값 ${t.key}=${t.value}`}
          >
            {t.good ? "○" : "✕"} {t.key}
          </li>
        );
      })}
    </ul>
  );
}

/** 개선 한 줄 — 막히는 지점에 대응하는 조치와 소관. */
export function FixLine({ status }: { status: AccessStatus }) {
  if (status.barrier === "완비") return null;
  const { label, owner } = actionOf(status.barrier);
  return (
    <p className="text-[12px] leading-relaxed text-dim lg:text-[11px]">
      개선: {label} <span className="opacity-70">({owner})</span>
    </p>
  );
}
