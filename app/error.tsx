"use client";

// 클라이언트 예외가 나도 발표 중 화면이 백지가 되지 않게 한다.
// 지도·deck.gl은 기기별 편차가 커서, 한 씬이 죽어도 되돌아갈 길이 필요하다.

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[scene] 렌더링 실패:", error);
  }, [error]);

  return (
    <div className="h-viewport flex flex-col items-center justify-center gap-4 bg-bg px-6 text-center text-ink">
      <div className="text-[15px] font-bold">이 화면을 그리지 못했습니다</div>
      <div className="max-w-[320px] text-[12px] leading-5 text-dim">
        기기의 그래픽 지원 범위를 벗어났거나 데이터를 읽지 못했습니다. 다시
        시도하거나 다른 화면으로 이동해 주세요.
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-lg border border-line bg-panel px-4 py-2 text-[12px] font-semibold text-ink"
        >
          다시 시도
        </button>
        <a
          href="/"
          className="rounded-lg border border-line px-4 py-2 text-[12px] font-semibold text-dim"
        >
          첫 화면으로
        </a>
      </div>
    </div>
  );
}
