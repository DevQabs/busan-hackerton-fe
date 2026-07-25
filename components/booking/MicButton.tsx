"use client";

// 음성 입력 버튼 — 출발지·도착지·탑승 시각 세 곳에서 같은 모양으로 쓴다.
//
// 접근성 요구가 두 개 겹친다. 스크린리더에게는 "무엇을" 말하는 버튼인지 알려야 하고
// (aria-label — 아이콘만 있는 버튼은 이름이 없으면 그냥 "버튼"으로 읽힌다), 시각
// 사용자에게는 지금 듣고 있는지 보여야 한다(테두리 맥동). 두 신호는 별개다.
//
// 터치 목표는 44px 이상 — 무대에서 화면을 가린 채 손가락으로 더듬어 누른다.

import { MicIcon } from "./MicIcon";

export function MicButton({
  label,
  listening,
  supported,
  onToggle,
}: {
  /** 접근 가능한 이름. 용도까지 담는다 — 예: "출발지 음성으로 입력" */
  label: string;
  listening: boolean;
  supported: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={!supported}
      aria-label={label}
      aria-pressed={listening}
      title={
        supported ? label : "이 브라우저는 음성 입력을 지원하지 않습니다 (Chrome 필요)"
      }
      className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border text-[17px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 ${
        listening
          ? "border-accent bg-accent/20 text-ink"
          : "border-line bg-panel text-dim hover:border-accent hover:text-ink"
      }`}
    >
      <MicIcon className="h-5 w-5" />
      {/* 듣는 중 표시. 정보는 aria-pressed와 라이브 영역이 이미 전달하므로
          이 링은 순수 시각 신호다. */}
      {listening && (
        <span
          aria-hidden
          className="animate-flow-pulse pointer-events-none absolute inset-[-3px] rounded-full border border-accent"
        />
      )}
    </button>
  );
}
