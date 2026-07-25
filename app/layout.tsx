import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorker } from "@/components/ServiceWorker";

export const metadata: Metadata = {
  title: "어디든 두가자 — 부산 교통약자 접근성 대시보드",
  description: "DIVE 2026 · 두리발 이동수요 × 무장애 인프라 사각지대 분석",
  // 홈 화면에 추가했을 때 iOS도 주소창 없이 뜨게 한다.
  appleWebApp: { capable: true, title: "두가자", statusBarStyle: "black-translucent" },
};

// /booking is used at phone width; the dashboard scenes stay desktop-sized.
// maximumScale is left at the default so pinch-zoom keeps working.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0f1a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="antialiased">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
