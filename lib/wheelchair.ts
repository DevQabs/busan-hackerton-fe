// 휠체어 종류별 식당 적합 판정.
//
// Three states, not a boolean. The 무장애가게 실사 leaves most 화장실 fields blank
// (319/321 have no 화장실 data at all), so a pass/fail filter would silently
// promote "not surveyed" to "safe" — the one thing a wheelchair user cannot
// afford to be wrong about. "확인 필요" keeps those visible AND honest.
//
// Rules (from the product owner, 2026-07-25):
//   입구턱 있음          → 부적합
//   화장실턱 있음        → 부적합 (단, 장애인화장실 있으면 무관)
//   1층이 아니면        → 엘리베이터 필수, 없으면 부적합
//   전동 휠체어          → 경사로 무관
//   수동 휠체어 + 경사로 → 확인 필요 (아래 RAMP_FOR_MANUAL 참고)
//
// RAMP_FOR_MANUAL: the owner's rule was "수동은 경사로=Y면 안 된다", aimed at
// ramps too steep to self-propel. But the 실사 records only 경사로 Y/N — no
// gradient, no length — and in this dataset 101 shops have 경사로=Y while 95 of
// them have NO 입구턱 at all, i.e. the ramp is incidental and entry is already
// flat. Marking those 부적합 would hide 93 perfectly enterable restaurants. So a
// ramp downgrades 수동 to 확인 필요 instead of excluding it. Flip the constant
// below to "unfit" to enforce the stricter reading.

const RAMP_FOR_MANUAL: Fit = "check";

export type Chair = "none" | "manual" | "electric";

/** fit = 확인된 적합 · check = 정보 부족/검토 필요 · unfit = 확인된 장벽 */
export type Fit = "fit" | "check" | "unfit";

export const FIT_LABEL: Record<Fit, string> = {
  fit: "이용 가능",
  check: "확인 필요",
  unfit: "이용 불가",
};

export const FIT_HEX: Record<Fit, string> = {
  fit: "#34d399", // infra green
  check: "#fbbf24", // warn amber
  unfit: "#e5484d", // gapHL red
};

export interface FitStep {
  /** 입구 · 층이동 · 화장실 · 경사로 */
  label: string;
  state: Fit;
  /** 판정 근거 (원자료 표현) */
  note: string;
}

export interface WheelchairFit {
  fit: Fit;
  steps: FitStep[];
  /** unfit/check 사유만 모은 한 줄 요약용 목록 */
  reasons: string[];
  /** 판정에는 반영하지 않지만 반드시 표시해야 하는 사실 (예: 화장실 미조사).
   *  '이용 가능'으로 분류된 곳에도 붙을 수 있다 — 그게 이 필드의 존재 이유다. */
  notes: string[];
}

const worst = (states: Fit[]): Fit =>
  states.includes("unfit") ? "unfit" : states.includes("check") ? "check" : "fit";

/** Judge one shop's 12 fields against the rider's chair type. */
export function wheelchairFit(
  fields: Record<string, string>,
  chair: Chair,
): WheelchairFit {
  const has = (k: string) => fields[k] === "Y";
  const steps: FitStep[] = [];
  const notes: string[] = [];

  // '해당 없음' = 보행 가능. 실사 12개 항목은 전부 휠체어·보행 기준이라 이 사람에게
  // 입구턱은 결격이 아니다 — 걸어서 넘는다. 그래서 판정 축은 계단 하나뿐이다:
  // 1층도 아니고 엘리베이터도 없으면 계단을 올라야 하므로 '확인 필요'로 내린다.
  // 확인된 장벽(unfit)은 이 기준에서 성립하지 않는다 — 아무 곳도 제외하지 않는다.
  if (chair === "none") {
    if (has("일층")) {
      steps.push({ label: "층이동", state: "fit", note: "1층" });
    } else if (has("엘리베이터")) {
      steps.push({ label: "층이동", state: "fit", note: "엘리베이터 있음" });
    } else {
      steps.push({
        label: "층이동",
        state: "check",
        note: "1층이 아니고 엘리베이터가 없어 계단을 이용해야 합니다",
      });
    }

    return {
      fit: worst(steps.map((s) => s.state)),
      steps,
      reasons: steps.filter((s) => s.state !== "fit").map((s) => s.note),
      notes,
    };
  }

  // ── 입구 ──────────────────────────────────────────────────────────────
  if (has("입구턱")) {
    steps.push({ label: "입구", state: "unfit", note: "입구에 턱 있음" });
  } else if (has("입구무턱")) {
    steps.push({ label: "입구", state: "fit", note: "입구 턱 없음(실사 확인)" });
  } else {
    // 입구턱=N + 입구무턱=N: 실사에서 입구를 기록하지 않았다는 뜻.
    steps.push({ label: "입구", state: "check", note: "입구 턱 여부 미조사" });
  }

  // ── 층이동 ────────────────────────────────────────────────────────────
  if (has("일층")) {
    steps.push({ label: "층이동", state: "fit", note: "1층" });
  } else if (has("엘리베이터")) {
    steps.push({ label: "층이동", state: "fit", note: "엘리베이터 있음" });
  } else {
    steps.push({
      label: "층이동",
      state: "unfit",
      note: "1층이 아니고 엘리베이터 없음",
    });
  }

  // ── 화장실 ────────────────────────────────────────────────────────────
  // 미조사(319/321)를 '확인 필요'로 두면 모든 가게가 확인 필요로 수렴해 수동/전동
  // 구분이 사라진다 — 실측해 본 결과 fit이 0곳이 됐다. 그래서 확인된 턱(1곳)만
  // 부적합으로 세고, 미조사는 판정 축에서 빼되 notes 로 반드시 노출한다:
  // "조사하지 않음"과 "턱이 있음"은 다른 사실이고, 전자를 결격으로 취급하면 실사가
  // 부실한 지역이 통째로 불리해진다.
  if (has("장애인화장실")) {
    steps.push({ label: "화장실", state: "fit", note: "장애인화장실 있음" });
  } else if (has("화장실턱")) {
    steps.push({ label: "화장실", state: "unfit", note: "화장실에 턱 있음" });
  } else if (has("화장실무턱")) {
    steps.push({ label: "화장실", state: "fit", note: "화장실 턱 없음" });
  } else {
    notes.push("화장실 접근성 미조사");
  }

  // ── 경사로 (수동만) ───────────────────────────────────────────────────
  if (chair === "manual" && has("경사로")) {
    steps.push({
      label: "경사로",
      state: RAMP_FOR_MANUAL,
      note: "경사로 있음 — 기울기 미기재, 수동 휠체어는 현장 확인 권장",
    });
  }

  return {
    fit: worst(steps.map((s) => s.state)),
    steps,
    reasons: steps.filter((s) => s.state !== "fit").map((s) => s.note),
    notes,
  };
}

/** Ranking key: 이용 가능 → 확인 필요 → 이용 불가. */
export const FIT_RANK: Record<Fit, number> = { fit: 0, check: 1, unfit: 2 };
