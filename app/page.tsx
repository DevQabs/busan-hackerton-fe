"use client";

// The whole dashboard is client-only (deck.gl + maplibre touch window/WebGL),
// so it is loaded with ssr:false from this thin client page.

import dynamic from "next/dynamic";

const Dashboard = dynamic(() => import("@/components/Dashboard"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen items-center justify-center text-sm text-dim">
      대시보드 불러오는 중…
    </div>
  ),
});

export default function Home() {
  return <Dashboard />;
}
