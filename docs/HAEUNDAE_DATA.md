# 해운대구 본선 데이터 산출물 가이드 (2026 DIVE)

2026-07-23 수령한 본선 원본 xlsx 11개 전부가 `public/data/`의 JSON으로 변환되어
있다. 원본은 repo 밖 `<codeVodca>/data/해운대구/`에 두고, 아래 두 스크립트로
재생성한다 (순수 stdlib, pandas/openpyxl 불필요):

```bash
python3 analysis/build_access_actions.py     # 01+03 → access_actions.json
python3 analysis/build_haeundae_datasets.py  # 02, 04~11 → haeundae_*.json
```

| 원본 | 산출물 | 건수 |
|---|---|---|
| 01 두리발 이동수요 (43,891행) | `access_actions.json` (dropoffs) | 완료 하차 37,687 |
| 03 무장애가게 | `access_actions.json` (shops) | 321 (전수) |
| 04~07 화장실/주차장/충전소/승강기 | `haeundae_facilities.json` | 310+348+16+584 = 1,258 |
| 02 상가(음식점) | `haeundae_shops.json` | 5,147 |
| 09 주민등록인구 (KOSIS) | `haeundae_population.json` | 19지역 × 15개월 × 5세구간 |
| 08 장애인 등록현황 | `haeundae_disability.json` | 19지역 × 15개월 (+10세 구간) |
| 10 총괄표제부 + 11 표제부 | `haeundae_buildings.json` | 490 단지 + 22,806 건물 |

`haeundae_*`는 기존 계약(`lib/types.ts`)과 무관한 **신규 standalone 아티팩트**다.
UI에 연결할 때 필요한 인터페이스만 types.ts에 추가하면 된다 (계약 변경은
팀 합의 후). `access_actions.json`에는 계약 외 추가 필드 `shops[].dong`,
`summary.dropoffsByDong`, `summary.shopsByDong`이 들어 있다 (기존 UI는 무시).

## 공통 규칙

- 좌표는 `lng`/`lat` (WGS84). 두리발 하차 좌표만 개인정보 규칙에 따라
  **소수 3자리(~100m)로 반올림** — 나머지(시설·상가)는 공개 시설이라 원좌표.
- 행정동 표기는 두리발·경계(`dongs.geojson`)와 같은 `우1동` 형식으로 정규화
  (원본 09는 `우제1동`, 08은 `부산광역시 해운대구 우1동` 형식이었음).
- `addr`에서 `부산광역시 해운대구 ` 접두어는 생략.
- 월 표기는 `2025-01` 형식.

## 스키마

### haeundae_facilities.json — 편의시설 1,258개 지점
```jsonc
{ "meta": {...},
  "points": [{
    "type": "toilet|parking|charger|elevator",
    "name": "APEC나루공원1호", "kind": "장애인 화장실",
    "addr": "우동 1494", "dong": "우2동",   // 좌표 폴리곤 판정 결과
    "dongSrc": "우2동",                      // 원본 표기가 판정과 다를 때만 (36건)
    "lng": 129.12747, "lat": 35.16856 }],
  "summary": { "total", "byType", "byDong": {"우2동": {"toilet":n,...}} } }
```
원본 '행정동' 컬럼에 법정동 표기·오매핑이 소수 있어 좌표 기반 판정을 정본으로
썼다. **송정동 충전소 0개** — 접근성 공백 포인트.

### haeundae_shops.json — 음식점 5,147곳
```jsonc
{ "shops": [{ "id": "MA0101...", "name": "집밥", "branch": "해운대"|null,
    "cat": ["음식","한식","백반/한정식"], "dong": "중1동", "bjdong": "중동",
    "addr": "도로명주소", "floor": "1"|null, "lng", "lat" }],
  "summary": { "total", "byDong" } }
```
무장애가게 321곳(access_actions.shops)과 좌표/상호로 대조하면 "실사 커버리지
6.2%" 같은 스토리가 나온다.

### haeundae_population.json — 주민등록인구 (월×5세구간)
```jsonc
{ "months": ["2025-01", ..., "2026-03"],   // 15개월
  "regions": [{ "dong": "해운대구"|"우1동"...,   // 첫 항목이 구 전체 합계
    "bands": { "계": [376213,...], "0-4": [...], ..., "100+": [...] } }] }
```

### haeundae_disability.json — 장애인 등록현황 (월별)
```jsonc
{ "months": ["2024-10", ..., "2025-12"],   // 15개월
  "totals": [{ "month", "dong",            // dong "해운대구" = 구 전체
    "total", "male", "female",
    "severe", "severeM", "severeF",        // 심한 장애
    "mild", "mildM", "mildF" }],           // 심하지 않은 장애
  "ages": [{ "month", "dong",
    "bands": { "0-9": [전체, 심한, 심하지않은], ..., "100+": [...] } }] }
```
원본은 1세 단위 → 10세 구간으로 집계. AGENTS.md가 예고한 NB 모델 offset 교체
(상가수 → 장애인등록 인구)의 재료.

### haeundae_buildings.json — 건축물대장 (좌표 없음, 법정동 단위)
```jsonc
{ "buildings": [{ // 11 표제부, 22,806동
    "addr": "반송동 2번지", "name": "반송동 공장"|null, "bjdong": "반송동",
    "kind": "일반|집합", "use": "주용도코드명",
    "floorsUp", "floorsDown",              // 지상/지하 층수
    "elevPass", "elevEmg",                 // 승용/비상용 승강기 수
    "households", "areaM2", "approvedYear" }],
  "complexes": [{ // 10 총괄표제부, 490단지
    "addr", "name", "bjdong", "use", "households", "parkingTotal", "areaM2" }],
  "summary": { "byBjdong": {"반송동": {"buildings","withElevator","elevators"}} } }
```
4.7MB로 무겁다 — 화면 전체 로드보다는 동/단지 프로필 등 필요할 때만 fetch 권장.
승강기 보유 건물 2,455/22,806 (10.8%).

## 남은 것 (이 문서 범위 밖)

- `pipeline/build_all.py` 스왑: `dongs.geojson`·`stats.json` 등 기존 계약
  아티팩트는 아직 2025-05 시 전역 공개 두리발 기준. 본선 두리발(01)로
  갈아끼우는 작업은 AGENTS.md "Finals data swap" 절차 참고 (출발 좌표가 없어
  od/unmet/dispatch_eta는 graceful degrade 필요).
- 두리발 01의 미배차·취소 6,204건은 어느 산출물에도 아직 없다 (하차시간이
  없어 access_actions 정의 밖). 필요하면 시간대×동 집계로 추가 가능.
