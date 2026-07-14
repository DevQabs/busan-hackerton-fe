<!-- verified: 2026-07-14 -->
# DIVE 2026 dashboard — data pipeline

Pure-stdlib Python 3 (no pandas/openpyxl). Produces every artifact in
`public/data/` following the contract in `lib/types.ts`. Coordinates are
`[lng, lat]` WGS84 everywhere.

## Run

```bash
cd pipeline
python3 build_all.py    # builds all 12 artifacts, writes match_report.txt
python3 validate.py     # contract + sanity checks, exit 1 on failure
```

At the finals: swap the input files (paths at the top of `build_all.py`),
re-run both scripts, and replace the `model_results.json` rehearsal entries
with final model outputs (`status: "final"`). Nothing else should change.

## Inputs and quirks

| Source | Encoding | Quirk handled |
|---|---|---|
| 두리발 trips CSV (May 2025, 37,512 rows) | CP949 | `X좌표`/`Y좌표` are SWAPPED (X≈35.1 = latitude). `swap_coords()` verifies by value range. |
| 전동휠체어 급속충전기 표준데이터 | CP949 | Filter strictly by `시도명 == '부산광역시'` (address matching false-positives on 부산면 in 전남). |
| 공중화장실정보 (부산) | CP949 | No coordinates — 구 parsed from road/jibun address (either may be empty). |
| 부산교통공사 승강기 설치현황 | CP949 | Aggregated per (호선, 역명); `firstYear` = min 설치년도. |
| HIRA 병원/약국 xlsx | xlsx | Parsed via zipfile+XML (`common.iter_xlsx_rows`). `좌표(X)`=lng, `좌표(Y)`=lat (NOT swapped). Busan filter: `시도코드명 == '부산'`. Rows without coords dropped. |
| 장애인 복지시설 SHP (DBF) | UTF-8 DBF | 5 records with coordinates outside the Busan bbox excluded. |
| 소상공인 상가정보 zip | UTF-8 BOM | Streamed from the zip without extraction; entry names are UTF-8(NFD)-through-cp437 mangled — decoded via `cp437 → utf-8 → NFC`, size fallback. |
| busan_dongs_raw.geojson (vuski/admdongkor) | UTF-8 | 206 행정동, `adm_cd2` = 10-digit code, `adm_nm` full name. |

## Trip outcome categories (disjoint, cover all 37,512 rows)

- `completed` — `결과 == '하차'` (32,526)
- `unassigned` — `결과 == '미배차'` (3,520; all of these also carry a 취소-family `상태`)
- `cancelled` — `상태` contains `취소` and `결과` is neither 하차 nor 미배차 (1,466)

`waitMinutes` = 접수→승차 for completed trips (values outside 0..24h dropped).

## Join logic

- **Trips → dong**: by full `행정동` string (e.g. `부산광역시 사상구 학장동`)
  against `adm_nm`. Normalization: `제` before a digit stripped on both sides
  (trips `가야1동` vs boundary `가야제1동`); alias `일광면 → 일광읍` (renamed
  2022). Busan-side match rate 100% (origin 37,194, dest 36,025 matched);
  remaining rows are 관외 (outside Busan) — counted in totals, excluded from
  dong aggregation. See `match_report.txt`.
- **Shops → dong**: `행정동코드` (8-digit in the source) == `adm_cd2[:8]`
  (all 206 `adm_cd2` end in `00` and are unique at 8 digits). 155,103/155,103
  joined (100%).
- **Chargers / hospitals / pharmacies / welfare → dong**: point-in-polygon
  (ray casting with bbox prefilter). 4 welfare points fall outside every dong
  polygon (coastline edges) — kept in `infra_points.json` without `dong`,
  excluded from dong counts.

## Derived metrics (heuristic gapScore — kept; uncertainty quantified by the day-cluster bootstrap below)

Per dong (n = 206), `z()` = population z-score across all dongs:

- `demandZ = z(dropoffs)` (completed dropoffs in the dong)
- `infraZ = mean( z(chargers), z(hospitals + pharmacies), z(welfare), z(shopsFloor1Share × shops) )`
  — `shopsFloor1Share` = share of shops on the 1st floor among shops with
  non-empty `층정보` (accessibility proxy); `null` share treated as 0 in the
  product.
- `gapScore = demandZ − infraZ + 0.5 × z(unassigned)` — higher = worse
  (demand outstrips accessible infrastructure and unmet demand is high).
- `gapClass`: demand and infra each flagged **H** when in the top tercile of
  their distribution, else **L**. `HL` = high demand & low/mid infra =
  사각지대 (priority). Currently 25 dongs are HL.
- `waitMedian` per dong: pickup-side, `null` when n < 10 completed trips.

## Statistical artifacts (REHEARSAL — real fits on May 2025 citywide data)

All four analyses below are computed by `build_all.py` on the real May data;
they carry `status: "rehearsal"` in `model_results.json` because the NB
exposure variable is a proxy (finals: replace with 장애인등록 인구 and set
`status: "final"`).

### wait_km.json — waiting-time survival analysis (Kaplan-Meier)

- **Event** = 배차 (vehicle assigned); duration = 접수→배차 minutes, capped at
  24 h, non-positive durations dropped.
- **Censoring rule**: requests that never got 배차 are censored at their
  취소시간 (this includes ALL 미배차 and the 취소 rows without 배차). Cancelled
  trips that DID receive 배차 count as events — assignment happened. Hence
  `censoredShare` 0.095 < (미배차+취소)/전체 = 0.133; the gap is the 1,427
  cancelled-after-assignment rows. Rows with neither 배차 nor 취소시간 would be
  dropped (0 such rows on the May file).
- **KM estimator** `S(t) = Π_{u≤t} (1 − d_u / r_u)` over distinct event times
  `u`; tie convention: censored observations at the same `t` as events remain
  in the risk set for that `t` (standard).
- `km.median` / `km.p90` = first `t` where `S(t) ≤ 0.5` / `0.1`, computed on
  the FULL-resolution curve. Published `curves` are downsampled to ≤120 points
  (step-function aware), so the visible crossing can differ slightly
  (e.g. median 20.1 vs curve crossing at 24.3) — not a bug.
- `naive` = percentiles of event durations only (drops censored) — the
  survivor-biased "official-style" number shown for contrast.
- `queue`: per request-hour p50/p90 of 접수→배차 and 배차→승차 (null when
  n < 20). `fleet`: distinct vehicles whose [배차, 하차] interval covers each
  day's h:30, averaged over 31 days.

### ghosts.json — unserved-request points

Pickup coords of unassigned + cancelled requests, rounded to 3 decimals
(~100 m, same privacy rule as `unmet.json`), `t` = seconds-of-day of 접수시간.
4,985 points (1 미배차 row lacks pickup coords).

### arrival_deserts.json — 250 m dropoff grid vs infra reach

- Cells: completed-dropoff counts on a ~250 m grid; kept when ≥ 20 dropoffs.
- `nearestM` = haversine meters to nearest charger/hospital/welfare, `null`
  beyond the 2 km cap.
- `score` = dropoffs × weighted shortage: charger missing-or->800m +1.5,
  hospital >500m +1.0, welfare >1km +0.5, dong 1층 상가 비율 below the citywide
  median +0.5. Ranked desc, top 200 kept (ranks assigned before the cap).
- `greedy`: maximal-coverage picks, radius 400 m, K = 10, stop when the best
  gain < 1% of total desert dropoffs. Finals: the infra layers are replaced by
  the 무장애가게 (barrier-free shop) dataset.

### NB regression — `dongs.expectedDropoffs` / `suppressedZ`, `model_results` nb-regression

- Model: per-dong completed dropoffs `y_i ~ NB(μ_i, α)` with
  `log μ_i = β·x_i + offset_i`, **offset = log(상가수 + 1)** — a rehearsal
  exposure proxy so coefficients read as rates per unit of street-level
  activity, not raw counts. Finals: offset switches to log(장애인등록 인구).
- Covariates: chargers, hospitals+pharmacies, welfare, floor-1 shop share
  (missing share mean-imputed).
- Fit (pure stdlib): Poisson IWLS → moment overdispersion
  `α = Σ((y−μ)² − μ) / Σμ²` → one NB re-weighted IWLS with working weights
  `w = μ/(1+αμ)`. `IRR = exp(β)`, 95% CI `= exp(β ± 1.96·SE)`,
  SE from `(XᵀWX)⁻¹`, p from the normal approximation.
- `suppressedZ` = z-scores of the NB deviance residuals; strongly negative =
  far fewer trips than the model expects given exposure = 잠재수요/침묵 수요
  candidate. `expectedDropoffs` = fitted `μ_i`.

### Day-cluster bootstrap — `dongs.gapCI` / `pTop5`, `model_results` bootstrap-stability

Resamples the **31 days with replacement (day clusters, NOT individual
rows)** — trips within a day are correlated, so row-level resampling would
understate variance. B = 500, seed 42, infra held fixed; per replicate the
per-dong dropoff/unassigned totals are rebuilt from the sampled days and
gapScore recomputed. `gapCI` = [5th, 95th] percentile (90% CI), `pTop5` =
share of replicates where the dong ranks in the top 5.

### Welch t & chi-square (`model_results` welch-t / chi-square)

- Welch t on **log** 접수→배차 wait, 수동 vs 전동, assigned trips only;
  Welch–Satterthwaite df, normal-approx p (df ≈ 10,475), Cohen's d on the
  pooled log-scale SD. `ratio` = exp(mean log difference) = ratio of
  geometric means.
- Chi-square 2×4 independence (미배차 여부 × 4 time bands), closed-form df=3
  survival `P(X>x) = erfc(√(x/2)) + √(2x/π)·e^(−x/2)`, Cramér's V, adjusted
  standardized residuals per cell.

## Other artifact notes

- `od.json`: completed trips with both endpoints matched, pairs with
  count ≥ 5, sorted desc, capped at 400 (cap is hit — smallest kept pair has
  count 15).
- `trips_anim.json`: completed trips with valid O+D coords inside the Busan
  bbox (34.9–35.5 lat / 128.7–129.5 lng), `t` = seconds-of-day of 승차/하차;
  missing/invalid 하차 → 승차 + max(5 min, 3 min/km × 거리). 32,358 candidates
  random-sampled to 12,000 with `random.Random(42)`.
- `unmet.json`: pickup coordinates of unassigned + cancelled requests rounded
  to 3 decimals (~100m cells) — no raw points for privacy.
- `stats.json.purpose`: top-12 `목적` values, remainder rolled into
  `기타(그 외)`.
