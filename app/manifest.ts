import type { MetadataRoute } from "next";
import { DEFAULT_SLUG } from "@/lib/scenes";

// 설치형(PWA) 정의. start_url을 첫 페이지로 두면 홈 화면 아이콘이 대시보드를
// 바로 연다 — 루트는 어차피 여기로 리다이렉트된다.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "어디든 두가자 — 부산 교통약자 접근성",
    short_name: "두가자",
    description: "DIVE 2026 · 두리발 이동수요 × 무장애 인프라 사각지대 분석",
    start_url: `/${DEFAULT_SLUG}`,
    scope: "/",
    display: "standalone",
    orientation: "any",
    lang: "ko",
    background_color: "#0b0f1a",
    theme_color: "#0b0f1a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      { name: "하루의 흐름", url: "/flow" },
      { name: "접근성 진단", url: "/accessibility" },
      { name: "해운대 상세 진단", url: "/haeundae" },
      { name: "배차 예약", url: "/booking" },
    ],
  };
}
