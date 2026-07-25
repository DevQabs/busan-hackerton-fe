"use client";

// 대시보드는 deck.gl·maplibre 때문에 클라이언트 전용이라 ssr:false로 싣는다.
// 주소의 조각이 곧 페이지다 — 링크로 특정 화면을 바로 열 수 있다.

import { use } from "react";
import dynamic from "next/dynamic";
import { notFound } from "next/navigation";
import { PAGE_BY_SLUG } from "@/lib/scenes";

const Dashboard = dynamic(() => import("@/components/Dashboard"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen items-center justify-center text-sm text-dim">
      대시보드 불러오는 중…
    </div>
  ),
});

export default function DashboardPage({
  params,
}: {
  params: Promise<{ page: string }>;
}) {
  const { page } = use(params);
  const id = PAGE_BY_SLUG[page];
  if (!id) notFound();
  return <Dashboard page={id} />;
}
