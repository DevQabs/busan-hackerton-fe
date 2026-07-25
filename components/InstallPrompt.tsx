"use client";

import { useEffect, useState } from "react";

// 크롬은 자동 배너를 더 이상 띄우지 않는다 — 메뉴에 "앱 설치"가 생길 뿐이라
// 아무도 못 찾는다. iOS 사파리는 프롬프트 자체가 없고 공유 시트로만 설치된다.
// 그래서 설치 가능할 때만 뜨는 작은 안내를 직접 붙인다.

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "dugaja-install-dismissed";

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<InstallEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // iOS 사파리 전용 플래그
      (window.navigator as { standalone?: boolean }).standalone === true;
    if (standalone) return;
    if (localStorage.getItem(DISMISS_KEY)) return;

    const ua = window.navigator.userAgent;
    const isIos = /iphone|ipad|ipod/i.test(ua);
    const isSafari = /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
    if (isIos && isSafari) {
      setIosHint(true);
      setHidden(false);
    }

    const onPrompt = (event: Event) => {
      event.preventDefault(); // 크롬 기본 배너 대신 우리가 띄운다
      setDeferred(event as InstallEvent);
      setIosHint(false);
      setHidden(false);
    };
    const onInstalled = () => setHidden(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (hidden) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setHidden(true);
  };

  return (
    <div className="fixed inset-x-3 bottom-20 z-50 md:inset-x-auto md:bottom-4 md:right-4 md:w-[320px]">
      <div className="flex items-start gap-3 rounded-lg border border-accent/50 bg-panel/95 px-3 py-2.5 shadow-lg backdrop-blur">
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-bold text-accent">
            홈 화면에 설치하면 오프라인에서도 열립니다
          </div>
          <div className="mt-0.5 text-[10.5px] leading-4 text-dim">
            {iosHint
              ? "사파리 하단 공유 버튼 → 홈 화면에 추가"
              : "설치 후 한 번 둘러보면 발표장 망이 끊겨도 지도와 수치가 그대로 뜹니다."}
          </div>
        </div>
        {deferred && (
          <button
            type="button"
            onClick={async () => {
              await deferred.prompt();
              await deferred.userChoice;
              setDeferred(null);
              setHidden(true);
            }}
            className="shrink-0 rounded-md border border-accent/60 bg-accent/15 px-2.5 py-1.5 text-[11px] font-semibold text-accent"
          >
            설치
          </button>
        )}
        <button
          type="button"
          onClick={dismiss}
          aria-label="닫기"
          className="shrink-0 rounded px-1 text-[13px] leading-5 text-dim hover:text-ink"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
