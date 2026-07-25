"use client";

import { EXTERNAL_PAGES, PAGES, PAGE_SLUG, type PageId } from "@/lib/scenes";

// 폰 전용 내비 — 240px 사이드바를 세로로 세울 수 없어서 하단 탭으로 바꾼다.
// 페이지가 정확히 4개라 한 줄에 들어가고, 엄지 도달 범위에 있다.
// md: 이상에서는 숨고 Sidebar가 다시 나온다.
//
// 두 곳에서 쓴다:
//  - 대시보드(/[page]) — onSelect가 오면 클라이언트 라우팅 버튼으로 그린다.
//  - 배차(/booking) — 별도 라우트라 onSelect가 없고, 전부 링크가 된다.
//    이쪽은 페이지가 세로로 스크롤하므로 floating(고정)으로 띄운다.

const TAB_BASE =
  "flex h-14 w-full flex-col items-center justify-center gap-0.5 px-1";

function TabInner({ active, label }: { active: boolean; label: string }) {
  return (
    <>
      <span
        aria-hidden
        className={`h-0.5 w-6 rounded-full ${active ? "bg-accent" : "bg-transparent"}`}
      />
      {/* break-keep — 한국어를 글자 단위로 끊지 않는다("접근성 진"에서 줄바꿈되면
          라벨이 오히려 더 안 읽힌다). 두 줄까지만 쓴다. */}
      <span className="line-clamp-2 break-keep px-0.5 text-center text-[11px] font-semibold leading-[13px]">
        {label}
      </span>
    </>
  );
}

export function BottomTabBar({
  page = null,
  onSelect,
  activeHref = null,
  floating = false,
}: {
  /** 대시보드에서 열려 있는 페이지. 배차 라우트에서는 null. */
  page?: PageId | null;
  /** 있으면 대시보드 탭이 버튼(클라이언트 라우팅)이 된다. */
  onSelect?: (id: PageId) => void;
  /** 외부 라우트가 현재 페이지일 때 그 href. */
  activeHref?: string | null;
  /** 스크롤하는 페이지 위에 고정으로 띄운다. */
  floating?: boolean;
}) {
  return (
    <nav
      aria-label="페이지"
      className={`border-t border-line bg-panel pb-[env(safe-area-inset-bottom)] md:hidden ${
        floating ? "fixed inset-x-0 bottom-0 z-40" : "shrink-0"
      }`}
    >
      <ul className="flex">
        {PAGES.map((item) => {
          const active = item.id === page;
          const tone = active ? "text-accent" : "text-dim";
          return (
            <li key={item.id} className="min-w-0 flex-1">
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(item.id)}
                  aria-current={active ? "page" : undefined}
                  className={`${TAB_BASE} ${tone}`}
                >
                  <TabInner active={active} label={item.short} />
                </button>
              ) : (
                <a
                  href={`/${PAGE_SLUG[item.id]}`}
                  aria-current={active ? "page" : undefined}
                  className={`${TAB_BASE} ${tone}`}
                >
                  <TabInner active={active} label={item.short} />
                </a>
              )}
            </li>
          );
        })}

        {EXTERNAL_PAGES.map((item) => {
          const active = item.href === activeHref;
          return (
            <li key={item.href} className="min-w-0 flex-1">
              <a
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`${TAB_BASE} ${active ? "text-accent" : "text-dim"}`}
              >
                <TabInner active={active} label={item.short} />
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
