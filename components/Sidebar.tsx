"use client";

import { SCENES, type SceneId } from "@/lib/scenes";

export function Sidebar({
  scene,
  onSelect,
}: {
  scene: SceneId;
  onSelect: (id: SceneId) => void;
}) {
  return (
    <nav className="flex w-60 shrink-0 flex-col border-r border-line bg-panel">
      <div className="border-b border-line px-4 py-4">
        <div className="text-[15px] font-bold leading-5 text-ink">
          어디든 <span className="text-accent">두가자</span>
        </div>
        <div className="mt-1 text-[11px] leading-4 text-dim">
          부산 교통약자 이동수요 × 무장애 인프라 사각지대
        </div>
      </div>

      <ol className="flex-1 overflow-y-auto px-2 py-2">
        {SCENES.map((s, i) => {
          const active = s.id === scene;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                aria-current={active ? "page" : undefined}
                className={`group mb-0.5 flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors ${
                  active ? "bg-[#1a2336]" : "hover:bg-[#161e30]"
                }`}
              >
                <span
                  className={`tnum mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[10px] font-semibold ${
                    active
                      ? "border-accent/60 bg-accent/10 text-accent"
                      : "border-line text-dim"
                  }`}
                >
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <span
                    className={`block text-[13px] font-medium leading-5 ${
                      active ? "text-ink" : "text-ink/80"
                    }`}
                  >
                    {s.label}
                  </span>
                  <span className="block truncate text-[11px] leading-4 text-dim">
                    {s.caption}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <footer className="border-t border-line px-4 py-3 text-[10px] leading-4 text-dim">
        DIVE 2026 · 아마란스H
        <br />
        데이터: 부산시설공단·윌체어·공공데이터포털
      </footer>
    </nav>
  );
}
