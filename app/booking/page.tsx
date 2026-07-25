"use client";

// 배차 예약 페이지 — 기존 7개 대시보드 씬(lib/scenes.ts)과 독립된 라우트.
// deck.gl + maplibre touch window/WebGL, so it loads client-only like app/page.tsx.

import dynamic from "next/dynamic";

const BookingApp = dynamic(() => import("@/components/booking/BookingApp"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen items-center justify-center text-sm text-dim">
      어디든 두가자 불러오는 중…
    </div>
  ),
});

export default function BookingPage() {
  return <BookingApp />;
}
