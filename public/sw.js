// 설치형 대시보드용 service worker.
//
// 목적은 두 가지다. 하나는 설치 가능 조건(fetch 핸들러)을 만족시키는 것, 다른
// 하나는 시연 중 네트워크가 끊겨도 세 페이지가 그대로 뜨게 하는 것 — 발표장
// 망에서 basemaps.cartocdn.com이 막히는 사례가 이미 있었다.
//
// 전략
//   내비게이션 : 네트워크 우선 → 실패하면 캐시 → 그것도 없으면 시작 페이지
//   /data/*    : 캐시 우선 + 백그라운드 갱신 (수십 MB를 미리 받지 않는다)
//   그 외 동일 출처 : 캐시 우선 + 백그라운드 갱신
//   외부 출처(타일 등) : 손대지 않는다 — 오프라인 폴백은 앱이 이미 처리한다
//
// 캐시 버전을 올리면 이전 캐시는 activate에서 통째로 지워진다.
const VERSION = "dugaja-v1";
const SHELL = [
  "/flow",
  "/accessibility",
  "/haeundae",
  "/booking",
  "/icon-192.png",
  "/icon-512.png",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      // 하나라도 실패하면 설치가 통째로 깨지므로 개별로 담는다.
      .then((cache) =>
        Promise.all(SHELL.map((url) => cache.add(url).catch(() => null))),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

/** 캐시를 즉시 돌려주고, 뒤에서 조용히 새로 받아 둔다. */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached || network || Response.error();
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // 타일·외부 API는 통과
  if (url.pathname.startsWith("/api/")) return; // 예약 프록시는 항상 실시간

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(VERSION);
          return (
            (await cache.match(request)) ||
            (await cache.match("/flow")) ||
            Response.error()
          );
        }),
    );
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});
