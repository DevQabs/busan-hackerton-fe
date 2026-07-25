"use client";

// 배차 대기 페이지(/booking)를 대시보드가 열려 있는 동안 미리 데운다.
//
// 발표에서 5번 메뉴를 누르는 순간 원래 세 가지가 한꺼번에 일어난다:
// ssr:false로 감싼 BookingApp 청크 다운로드(maplibre·deck.gl 포함), artifact
// 5개(합 3MB) 내려받기, 그 JSON 파싱. 눌린 뒤에 하면 그대로 대기 시간이 된다.
//
// 다만 미리 받는 값은 공짜가 아니다. 3MB를 배경에서 파싱하면 그 시간만큼 메인
// 스레드가 멈춰서, 지금 보고 있는 지도가 끊긴다 — 고칠 문제를 옮겨 놓는 셈이다.
// 그래서 두 단계로 나눈다:
//
//  · 가벼운 쪽(warm) — 페이지 청크와 게이트 artifact 2개. load 이후 유휴
//    시간에, 낮은 우선순위로. 첫 화면을 그리는 데 필요한 최소치다.
//  · 무거운 쪽(warmRest) — 목적지를 고른 뒤에야 쓰이는 2MB. 배경에서 돌리지
//    않고, 메뉴 항목에 마우스가 올라가거나 포커스가 갈 때 시작한다. 발표자가
//    누르기 직전이 정확히 그 순간이고, 안 누르면 아예 받지 않는다.

import { DATA } from "@/lib/types";
import { prefetchData } from "@/lib/useData";

/** 첫 화면을 그리기 위해 반드시 있어야 하는 것 (BookingApp의 dataPending). */
const GATING = [DATA.dongs, DATA.dispatchEta] as const;
/** 목적지를 고른 뒤에 쓰이는 것 — 합 2MB. */
const REST = [
  DATA.infraPoints,
  DATA.accessActions,
  DATA.haeundaeFacilities,
] as const;

let warmed = false;
let restWarmed = false;

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
};

/** requestIdleCallback이 없는 브라우저(사파리 일부)에서는 타이머로 대신한다. */
function onIdle(fn: () => void, timeout: number) {
  const ric = (window as IdleWindow).requestIdleCallback;
  if (ric) ric(fn, { timeout });
  else window.setTimeout(fn, timeout);
}

/** 현재 화면이 다 뜬 다음에 움직인다 — load 전에는 대시보드 자신이 아직
 *  artifact를 받고 있어서, 여기서 끼어들면 그쪽이 느려진다. */
function afterLoad(fn: () => void) {
  if (document.readyState === "complete") fn();
  else window.addEventListener("load", fn, { once: true });
}

/** 대시보드가 열릴 때 한 번. 가벼운 쪽만. */
export function prefetchBooking() {
  if (warmed || typeof window === "undefined") return;
  warmed = true;
  afterLoad(() =>
    onIdle(() => {
      prefetchData(GATING);
      // Link의 prefetch는 라우트 청크까지만 가져온다 — dynamic(ssr:false)로 감싼
      // BookingApp은 별도 청크라 여기서 직접 불러야 한다. 실패는 무시한다:
      // 어차피 페이지를 열 때 다시 시도하고, 그때 로딩 문구가 뜬다.
      void import("@/components/booking/BookingApp").catch(() => {});
    }, 3000),
  );
}

/** 메뉴 항목에 hover/focus가 왔을 때 — 곧 누른다는 신호. */
export function prefetchBookingRest() {
  if (restWarmed || typeof window === "undefined") return;
  restWarmed = true;
  prefetchData(REST);
}
