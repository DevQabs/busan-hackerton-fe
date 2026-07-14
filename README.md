# 어디든 두가자 — Busan Wheelchair-Accessibility Dashboard (DIVE 2026)

Analytics dashboard for the DIVE 2026 hackathon: 두리발 (Busan special transport)
trip demand crossed with barrier-free infrastructure to surface 사각지대
(high-demand / low-infrastructure dongs) and simulate improvements.

Team: 아마란스H · Data: 부산시설공단 · 윌체어 · 공공데이터포털

## Run

```bash
npm install
npm run dev        # http://localhost:3000
```

Production:

```bash
npm run build
npm run start
```

`npm run typecheck` runs `tsc --noEmit` (strict).

## Finals data swap — no UI changes needed

The UI reads ONLY the JSON artifacts in `public/data/`, with schemas and file
names frozen in `lib/types.ts` (the data contract). At the finals:

1. Drop the new input CSVs into the pipeline (`pipeline/`).
2. Re-run the pipeline so it rewrites `public/data/*.json` / `dongs.geojson`.
3. Reload the browser — nothing else. All KPIs, charts, map layers, rankings
   and the simulation recompute from the new artifacts.

If an artifact is missing or unparsable the affected panel shows
"데이터 준비 중…" and silently re-polls every 8 seconds, so the dashboard picks
up pipeline output as soon as it lands (no reload needed).

`model_results.json` is the data scientist's slot: cards render its
`headline`/`detail`/`numbers` as-is; `status: "placeholder"` shows a
"분석 대기" badge, `"final"` shows "확정".

## Scene guide (sidebar order = story order)

| # | Scene | What it shows |
|---|-------|---------------|
| 1 | 개요 | KPI cards (총 이용·미배차율·대기시간·휠체어 비중), hourly/day-of-week charts, faint dropoff choropleth |
| 2 | 이동수요 지도 | 3D hexagon density (250m) of trip endpoints vs dong choropleth, hour-range filter |
| 3 | 하루의 흐름 | Animated trips over seconds-of-day (TripsLayer), play/pause, 30/120/300× speed, clock, colors by wheelchair type |
| 4 | OD 흐름 | Origin→destination arcs between dong centroids, width ∝ √count, dong list filters arcs |
| 5 | 사각지대 분석 | Bivariate demand×infra choropleth (HL red = priority), click a dong for full detail |
| 6 | 미충족 수요 | 100m cells of unassigned/cancelled requests, hourly unassigned chart |
| 7 | 인프라 지도 | POI layer with type toggles (충전소/병의원/약국/복지시설), toilets-per-구 bars, metro elevator table |
| 8 | 우선순위·시뮬레이션 | Top-20 dongs by gapScore (sortable, shortage badges), "충전소 +1" simulation with live rank change |
| 9 | 통계 모델 | Result cards from `model_results.json` (filled by the data scientist at finals) |

## Architecture

- Next.js 15 (app router) + React 19, TypeScript strict, Tailwind v4.
- deck.gl 9 layers over a MapLibre basemap via `MapboxOverlay`
  (`react-map-gl/maplibre` `useControl`), all client-side (`ssr: false`).
- State: React hooks only. Each scene component owns its local UI state and
  pushes `{layers, getTooltip}` up to the shared map via a callback.
- `lib/useData.ts`: shared fetch hook with in-memory cache + error state +
  8s re-poll on failure.
- `lib/types.ts`: the pipeline↔UI data contract — do not edit casually.

## Offline note

The CARTO dark basemap (`basemaps.cartocdn.com`) needs internet. If it cannot
load, the app automatically falls back to rendering all deck.gl data layers on
the dark background (badge: "베이스맵 오프라인") — every scene stays fully
functional, only the street context is missing.
