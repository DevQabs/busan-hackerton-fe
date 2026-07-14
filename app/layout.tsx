import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "어디든 두가자 — 부산 교통약자 접근성 대시보드",
  description: "DIVE 2026 · 두리발 이동수요 × 무장애 인프라 사각지대 분석",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
