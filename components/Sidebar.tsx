"use client";

import Link from "next/link";
import { EXTERNAL_PAGES, PAGES, PAGE_SLUG, type PageId } from "@/lib/scenes";
import { prefetchBookingRest } from "@/lib/prefetchBooking";

// 두 곳에서 쓴다 (BottomTabBar와 같은 규칙):
//  · 대시보드(/[page]) — onSelect가 오면 씬 전환 버튼이 된다(클라이언트 라우팅).
//  · 배차(/booking) — 별도 라우트라 onSelect가 없고, 전부 주소 링크가 된다.
//
// 링크는 <a>가 아니라 next/link다. <a>는 문서를 통째로 다시 읽어서 번들
// (maplibre·deck.gl)을 재파싱하고 useData의 모듈 캐시까지 버린다 — 이미 받은
// dongs·infra_points를 다시 받게 된다. Link는 청크를 미리 가져오고 캐시를 살린다.
export function Sidebar({
  page = null,
  onSelect,
  activeHref = null,
}: {
  /** 대시보드에서 열려 있는 페이지. 배차 라우트에서는 null. */
  page?: PageId | null;
  onSelect?: (id: PageId) => void;
  /** 외부 라우트가 현재 페이지일 때 그 href. */
  activeHref?: string | null;
}) {
  return (
    // 폰에서는 숨고 BottomTabBar가 대신 선다 — 240px를 세로로 세울 방법이 없다.
    // sticky/h-screen은 배차 페이지처럼 문서 전체가 스크롤하는 화면에서 메뉴가
    // 위로 흘러가 버리지 않게 한다(대시보드는 부모가 이미 100dvh라 영향 없다).
    <nav className="hidden w-60 shrink-0 flex-col border-r border-line bg-panel lg:sticky lg:top-0 lg:flex lg:h-[100dvh]">
      <div className="border-b border-line px-4 py-4">
        <div className="text-[15px] font-bold leading-5 text-ink">
          어디든 <span className="text-accent">두가자</span>
        </div>
        <div className="mt-1 text-[11px] leading-4 text-dim">
          부산 교통약자 이동수요 × 무장애 인프라 사각지대
        </div>
      </div>

      <ol className="flex-1 overflow-y-auto px-2 py-2">
        {PAGES.map((item, i) => {
          const active = item.id === page;
          // cursor-pointer를 명시하는 이유: button은 기본 커서가 화살표라
          // 링크인 5번 항목만 손가락이 뜨고 1~4번은 안 뜬다 — 같은 메뉴에서
          // 어떤 줄은 눌리고 어떤 줄은 안 눌리는 것처럼 보인다.
          const cls = `group mb-0.5 flex w-full cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors ${
            active ? "bg-[#1a2336]" : "hover:bg-[#161e30]"
          }`;
          const inner = (
            <>
              <span
                className={`tnum mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[10px] font-semibold ${
                  active
                    ? "border-accent/60 bg-accent/10 text-accent"
                    : "border-line text-dim"
                }`}
              >
                {i + 1}
              </span>
              <span className="min-w-0">
                <span
                  className={`block text-[13px] font-medium leading-5 ${
                    active ? "text-ink" : "text-ink/80"
                  }`}
                >
                  {item.label}
                </span>
                <span className="block truncate text-[11px] leading-4 text-dim">
                  {item.caption}
                </span>
              </span>
            </>
          );
          return (
            // 대시보드 안에서는 버튼(씬 전환), 배차 라우트에서는 주소 링크.
            <li key={item.id}>
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(item.id)}
                  aria-current={active ? "page" : undefined}
                  className={cls}
                >
                  {inner}
                </button>
              ) : (
                <Link
                  href={`/${PAGE_SLUG[item.id]}`}
                  aria-current={active ? "page" : undefined}
                  className={cls}
                >
                  {inner}
                </Link>
              )}
            </li>
          );
        })}

        {/* 별도 라우트라 버튼이 아니라 링크다 — 대시보드 씬 상태로는 열 수 없고,
            번호는 앞의 페이지들에 이어서 붙인다. */}
        {EXTERNAL_PAGES.map((item, i) => {
          const active = item.href === activeHref;
          return (
          <li key={item.href}>
            <Link
              href={item.href}
              // 곧 누른다는 신호 — 무거운 artifact를 이때 받는다.
              // 배경에서 미리 받으면 지금 보고 있는 지도가 끊긴다.
              onPointerEnter={prefetchBookingRest}
              onFocus={prefetchBookingRest}
              aria-current={active ? "page" : undefined}
              className={`group mb-0.5 flex w-full cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors ${
                active ? "bg-[#1a2336]" : "hover:bg-[#161e30]"
              }`}
            >
              <span
                className={`tnum mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[10px] font-semibold ${
                  active
                    ? "border-accent/60 bg-accent/10 text-accent"
                    : "border-line text-dim"
                }`}
              >
                {PAGES.length + i + 1}
              </span>
              <span className="min-w-0">
                <span
                  className={`block text-[13px] font-medium leading-5 ${
                    active ? "text-ink" : "text-ink/80"
                  }`}
                >
                  {item.label}
                </span>
                <span className="block truncate text-[11px] leading-4 text-dim">
                  {item.caption}
                </span>
              </span>
            </Link>
          </li>
          );
        })}
      </ol>

      <footer className="border-t border-line px-4 py-3 text-[10px] leading-4 text-dim">
        DIVE 2026
        <br />
        데이터: 부산시설공단·윌체어·공공데이터포털
      </footer>
    </nav>
  );
}
