"use client";

/** 마이크 픽토그램 — 헤더 진입 버튼과 필드별 MicButton이 같은 그림을 쓴다.
 *  이모지(🎤)는 안드로이드·윈도우·iOS에서 그림이 제각각이고 색도 못 맞춰서 선
 *  아이콘으로 고정한다. 색은 부모의 currentColor를 따라간다. */
export function MicIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={`shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}
