"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DATA,
  type ArrivalDeserts,
  type DongProps,
  type ModelCharts,
  type ModelResult,
  type Stats,
} from "@/lib/types";
import { useData } from "@/lib/useData";
import { type DongCollection, type MapSpec } from "@/lib/mapspec";
import { DataPending } from "@/components/ui/DataPending";
import { Explainer } from "@/components/ui/Explainer";
import { fmt, pct } from "@/lib/format";
import { HEX } from "@/lib/palette";
import {
  BandUnmetBar,
  CorrScatter,
  FunnelBars,
  GapCiTop,
  IrrForest,
  TypePurposeHeat,
  WaitHistCompare,
  type CorrPoint,
  type GapCiRow,
  type IrrRow,
} from "@/components/charts/ModelEvidence";

/* ================================================================== */
/*  실행주체 (정책 수신자)                                             */
/* ================================================================== */

type Owner = "공단" | "구청" | "윌체어";

const OWNER_META: Record<Owner, { full: string; role: string; color: string }> = {
  공단: { full: "부산시설공단", role: "두리발 운영", color: HEX.demand },
  구청: { full: "부산시 · 구청", role: "인프라 예산", color: HEX.infra },
  윌체어: { full: "윌체어", role: "데이터 · 서비스", color: HEX.tourism },
};
const OWNER_ORDER: Owner[] = ["공단", "구청", "윌체어"];

/* ================================================================== */
/*  내러티브 순서 — 분석 → 정책 → 다음 질문으로 이어지는 흐름          */
/* ================================================================== */

interface StoryStep {
  id: string;
  short: string; // 타임라인 노드 라벨
  question: string; // 이 분석이 답하는 질문 (스테이지 부제)
  owners: Owner[];
  policyTitle: string; // 정책 한 줄 제목
  bridge: string; // 다음 분석으로 잇는 문장
}

const STORY: StoryStep[] = [
  {
    id: "retry-funnel",
    short: "미충족",
    question: "미충족 수요는 실재하는가?",
    owners: ["공단"],
    policyTitle: "목표지표를 '탑승 건수'에서 '포기율'로 재정의",
    bridge: "그렇다면 이 실패와 포기는 하루 중 언제 몰리는가?",
  },
  {
    id: "chi-square",
    short: "시간대",
    question: "배차 실패는 언제 몰리는가?",
    owners: ["공단"],
    policyTitle: "저녁 미배차 — 증차 전에 운영 구조부터 점검",
    bridge: "실패만이 아니라, 성공한 배차의 '대기 시간'은 유형별로 공정한가?",
  },
  {
    id: "welch-t",
    short: "형평",
    question: "휠체어 유형 간 대기는 공정한가?",
    owners: ["공단"],
    policyTitle: "형평성 점검 — '큰 격차 없음' 안심 보고",
    bridge: "형평은 확인됐다. 그렇다면 수요 자체는 어디에, 왜 몰리는가?",
  },
  {
    id: "correlation",
    short: "수요",
    question: "수요는 무엇을 따라 움직이는가?",
    owners: ["윌체어", "구청"],
    policyTitle: "숨은 수요지 4개 동 우선 현장 점검",
    bridge: "상권 효과를 걷어냈다. 그럼 무장애 인프라 '자체'는 방문을 끌어당기는가?",
  },
  {
    id: "nb-regression",
    short: "인프라 효과",
    question: "인프라가 수요를 끌어당기는가?",
    owners: ["구청", "윌체어"],
    policyTitle: "충전소 신규 입지 — 하차 밀도 기준으로",
    bridge: "인프라가 수요를 부른다면, 누구를 위한 인프라인가? 유형마다 목적이 다른가?",
  },
  {
    id: "chi-square-type-purpose",
    short: "맞춤",
    question: "'교통약자'는 하나의 집단인가?",
    owners: ["공단", "윌체어"],
    policyTitle: "유형별 맞춤 안내 — 부가기능 아닌 핵심 설계 원리",
    bridge: "이렇게 도출한 우선순위, 데이터가 조금 달랐어도 유지될까?",
  },
  {
    id: "bootstrap-stability",
    short: "신뢰도",
    question: "이 우선순위, 믿어도 되는가?",
    owners: ["구청", "공단"],
    policyTitle: "예산 심의 인용 가능 — 순위 + 신뢰도 병기",
    bridge: "세 실행주체의 실행안이 모두 데이터에서 나왔다 — 아래 종합으로.",
  },
];

/* ================================================================== */
/*  해석 (비전문가용 "쉽게 읽으면") — id별                             */
/* ================================================================== */

const INTERPRET: Record<string, ReactNode> = {
  "retry-funnel": (
    <>
      <p>
        택시가 안 잡힐 때를 떠올려 보세요. 어떤 사람은 몇 분 뒤 다시 부르지만,
        어떤 사람은 &ldquo;오늘은 그냥 안 나가자&rdquo; 하고 약속을 포기합니다.
        두리발도 똑같습니다. 5월 한 달 동안 배차 실패(미배차)나 취소로 끝난 호출을
        추적해 보니, <b className="text-ink">같은 자리에서 60분 안에 다시 부른
        사람은 절반 정도뿐</b>이었습니다.
      </p>
      <p className="mt-2">
        나머지 절반은 그날 그 자리에서 다시 부르지 않았습니다 — 가족 차를 얻어
        탔거나, <b className="text-ink">아예 외출을 포기한 것으로 추정</b>됩니다.
        핵심은 이것입니다: 미충족 수요는 통계표 속 숫자가 아니라{" "}
        <b className="text-ink">&ldquo;실제로 일어나지 못한 외출&rdquo;</b>,
        즉 병원에 못 간 하루이고 못 만난 사람입니다. 그래서 서비스가 좋아졌는지를
        재는 잣대는 &lsquo;몇 명 태웠나&rsquo;가 아니라{" "}
        <b className="text-ink">&lsquo;몇 명이 포기하지 않게 됐나&rsquo;</b>가
        되어야 합니다.
      </p>
    </>
  ),
  "chi-square": (
    <>
      <p>
        만약 배차 실패가 하루 중 아무 때나 골고루 일어난다면, 시간대별 실패율은
        비슷해야 합니다. 아침에 10%면 저녁에도 10% 정도여야 자연스럽죠. 그런데
        실제 데이터는 달랐습니다.{" "}
        <b className="tnum text-unmet">저녁(16–24시)에 접수한 호출의 15.9%</b>가
        차를 못 잡고 끝나, 하루 전체 평균 9.4%를 크게 웃돌았습니다.
      </p>
      <p className="mt-2">
        이 쏠림이 &ldquo;우연히 그런 것 아니냐&rdquo;를 카이제곱 검정으로 따져
        보니 우연일 가능성은 사실상 0에 가까웠습니다(χ²=335, p&lt;0.0001).
        다만 정직하게 덧붙이면, 시간대가 실패를 설명하는 힘 자체는 크지
        않습니다(Cramér&rsquo;s V=0.094 — &lsquo;작음&rsquo;). 그래서 우리는
        &ldquo;저녁이 미배차의 주범&rdquo;이라고 과장하지 않고,{" "}
        <b className="text-ink">&ldquo;실패가 저녁 특정 시간대에 눈에 띄게
        몰린다&rdquo;는 진단</b>으로만 읽습니다.
      </p>
    </>
  ),
  "welch-t": (
    <>
      <p>
        수동휠체어와 전동휠체어 이용자가 차를 기다리는 시간에 차별이 없는지
        확인했습니다. 결과는{" "}
        <b className="tnum text-ink">수동휠체어 쪽이 평균 약 14% 더 오래</b>{" "}
        기다렸습니다. 표본이 워낙 커서(두 그룹 합쳐 2만 4천여 건) 통계적으로는
        &ldquo;확실히 차이가 있다&rdquo;고 나옵니다(t=5.63, p&lt;0.0001).
      </p>
      <p className="mt-2">
        하지만 여기서 흔한 함정을 피해야 합니다.{" "}
        <b className="text-ink">&lsquo;통계적으로 유의하다&rsquo;와 &lsquo;실제로
        큰 차이다&rsquo;는 다른 말</b>입니다. 차이의 크기를 재는 지표(d=0.085)로
        보면 이 격차는 관례상 &ldquo;작음&rdquo;에 해당합니다. 쉽게 말해{" "}
        <b className="text-ink">&ldquo;차이는 분명히 있지만, 실무적으로 문제 삼을
        만큼 큰 격차는 아니다&rdquo;</b>. 배차 시스템이 휠체어 종류로 사람을
        차별하고 있지는 않다는, 오히려 안심할 수 있는 점검 결과입니다.
      </p>
    </>
  ),
  correlation: (
    <>
      <p>
        상가가 많은 동네일수록 두리발 하차도 많았습니다 &mdash; 사람이 갈 데가
        많으니 당연한 이야기죠. 그런데 이 &lsquo;당연함&rsquo;을 굳이 증명한 데는
        이유가 있습니다. 뒤에서 &ldquo;무장애 인프라가 수요를 끌어당긴다&rdquo;고
        주장하려면, 먼저 <b className="text-ink">&ldquo;그냥 상권이 커서 사람이
        많은 것 아니냐&rdquo;는 반박을 데이터로 걷어내야</b> 하기 때문입니다.
        이 카드가 그 사전 정지 작업입니다.
      </p>
      <p className="mt-2">
        더 흥미로운 건 <b style={{ color: HEX.unmet }}>회귀선 위로 크게 튀어
        오른 붉은 점 4곳</b>입니다. 이 동네들은 상가 규모만 보면 설명되지 않을
        만큼 두리발 수요가 많습니다. 재활원·요양병원·복지관이 몰려 있는{" "}
        <b className="text-ink">&lsquo;교통약자의 숨은 중심지&rsquo;</b>로
        추정되며, 일반 유동인구를 기준으로 짜는 기존 도시계획에서는 놓치기 쉬운
        곳입니다. 데이터가 &ldquo;여기를 먼저 보라&rdquo;고 손가락으로 가리키는
        셈입니다.
      </p>
    </>
  ),
  "nb-regression": (
    <>
      <p>
        앞 카드에서 상권 효과를 걷어냈으니, 이제 진짜 질문에 답합니다:{" "}
        <b className="text-ink">인프라 자체가 수요를 끌어당기는가?</b> 상권 등 다른
        조건이 비슷한 동네끼리 비교했더니, 급속충전기가 1기 더 있는 동네는 두리발
        하차가 약 <b className="tnum text-ink">22% 더 많은 경향</b>이 있었습니다(IRR
        1.223, 즉 &lsquo;1.22배&rsquo;. 95% 신뢰구간 1.10&ndash;1.36으로 이 범위가
        1을 넘으니 우연으로 보기 어렵습니다).
      </p>
      <p className="mt-2">
        여기서 <b className="text-ink">반드시 지켜야 할 선</b>이 있습니다. 이건{" "}
        <b className="text-ink">&lsquo;연관&rsquo;이지 &lsquo;인과&rsquo;가
        아닙니다.</b> 충전기를 세우면 하차가 22% 늘어난다는 보장이 아니라,
        &ldquo;충전기가 있는 곳에 전동휠체어 이용자가 실제로 찾아가고 있다&rdquo;는
        뜻입니다. 참고로 &lsquo;1층 상가 비율&rsquo; 변수는 신뢰구간이 1을 포함해
        이번 분석에서는 유의하지 않았고, 우리는 그 사실도 숨기지 않고 그대로
        보여줍니다.
      </p>
    </>
  ),
  "chi-square-type-purpose": (
    <>
      <p>
        정책이 흔히 저지르는 실수는 &lsquo;교통약자&rsquo;를 하나의 덩어리로
        보는 것입니다. 데이터는 정반대를 말합니다. <b className="text-ink">시각장애인은
        출퇴근</b>이 압도적으로 많았는데, 이는 우연이 아니라 안마사 국가자격
        제도와 정확히 맞물린 결과입니다(오전 7시에 이동이 집중).{" "}
        <b className="text-ink">신장장애인은 병원</b>이 많았고(주 3회 투석이라는
        고정된 생명 주기), 65세 이상 고령층도 병원 중심이었습니다.
      </p>
      <p className="mt-2">
        &ldquo;장애유형과 이동 목적이 서로 무관하다&rdquo;는 가정을 검정으로
        따져 보니 압도적으로 기각됐습니다 &mdash; 유형이 다르면 가는 곳이
        확연히 다릅니다. 이것은 &lsquo;어디든 두가자&rsquo;의{" "}
        <b className="text-ink">유형별 맞춤 안내(전동→충전소, 시각→음성·보도 정보,
        신장→투석 시설)가 있으면 좋은 부가 기능이 아니라, 데이터가 요구하는 핵심
        설계 원리</b>임을 보여주는 통계적 근거입니다.
      </p>
    </>
  ),
  "bootstrap-stability": (
    <>
      <p>
        우선순위 순위표는 딱 한 달치 데이터로 만든 것입니다. 그러면 당연히 이런
        의심이 듭니다 &mdash; <b className="text-ink">&ldquo;하필 그 한 달이라
        그런 것 아니냐, 다른 달이었으면 순위가 바뀌지 않았겠느냐?&rdquo;</b> 이
        질문에 답하려고, 5월 데이터를 날짜 단위로 섞어 500번 다시 뽑아 순위를
        매번 새로 계산해 봤습니다(부트스트랩).
      </p>
      <p className="mt-2">
        결과는 든든했습니다. 사상구 학장동은{" "}
        <b className="tnum text-ink">500번 모두 상위 5위 안</b>에 들었고, 격차점수의
        90% 신뢰구간도 다른 동네와 겹치지 않았습니다. 즉 이 순위표의 최상위권은{" "}
        <b className="text-ink">데이터를 아무리 흔들어도 흔들리지 않는 안정적
        결론</b>이라, 예산 심의처럼 &ldquo;틀리면 곤란한&rdquo; 자리에서도 자신
        있게 인용할 수 있습니다.
      </p>
    </>
  ),
};

/* ================================================================== */
/*  정책 (경영판단) — id별. 실행주체는 칩으로 별도 표기하므로 본문엔 생략 */
/* ================================================================== */

const POLICY: Record<string, ReactNode> = {
  "retry-funnel": (
    <p>
      서비스 목표지표(KPI)를 탑승 건수에서 <b className="text-ink">포기율</b>로
      재정의합니다. 월 2,600여 건의 &ldquo;사라진 외출&rdquo;이 회수 가능한
      시장이며, 미충족이 몰리는 시간·지역에 배차를 우선 투입하고, 정확한 대기시간
      안내로 재시도를 유도하는 것이 증차 없이 가능한 개선입니다.
    </p>
  ),
  "chi-square": (
    <p>
      저녁 미배차 편중의 1차 대응은 증차(예산↑)가 아니라{" "}
      <b className="text-ink">운영 구조 점검(저비용)</b>입니다 — 교대 시간 조정,
      야간 전담조, 저녁 배차 정책. 저녁엔 차량당 수요가 오히려 적은데도 미배차율이
      치솟는 것은 공급 총량보다 운영 구조 요인을 시사하므로,
      &ldquo;저녁 배차 실패의 운영 로그 확인&rdquo;을 질문으로 제안합니다.
    </p>
  ),
  "welch-t": (
    <p>
      휠체어 유형 간 배차 형평성은{" "}
      <b className="text-ink">&ldquo;점검 결과 큰 격차 없음&rdquo;</b>으로
      보고합니다 — 문제 제기가 아니라 안심 자료. 남는 소폭 차이의 원인(리프트
      장착 차량 비율, 지역 분포)은 본선 데이터로 확인 후 필요 시 차량 사양 배치
      조정을 제안합니다.
    </p>
  ),
  correlation: (
    <p>
      잔차 상위 4개 동을 <b className="text-ink">우선 현장 점검 대상</b>으로
      제안합니다. 상권 기준의 기존 정비계획에서 누락되는 교통약자 특수
      수요지이므로, 윌체어의 무장애 정보 수집과 구청의 시설 점검을 이 동들부터
      시작하는 것이 데이터가 가리키는 순서입니다.
    </p>
  ),
  "nb-regression": (
    <p>
      신규 충전소 입지를 관공서·공공시설 기준이 아니라{" "}
      <b className="text-ink">전동휠체어 이용자의 실제 하차 밀도</b> 기준으로 정합니다(도착지
      사각지대 씬의 그리디 후보 지점 활용). 이 IRR이 우선순위 씬의 &ldquo;충전소
      +1기 기대효과&rdquo; 시뮬레이션 근거이며, 예산 배분 자료로 바로 쓸 수 있는
      형식입니다.
    </p>
  ),
  "chi-square-type-purpose": (
    <p>
      &lsquo;어디든 두가자&rsquo;의 <b className="text-ink">유형별 맞춤 안내</b>를
      핵심 설계 원리로 채택하고(전동→충전소, 시각→음성·보도 정보), 투석처럼 주기가
      고정된 생명 직결 수요는 <b className="text-ink">정기예약 전용 슬롯</b>으로 대기
      경쟁에서 분리하면 전체 배차 효율이 올라갑니다.
    </p>
  ),
  "bootstrap-stability": (
    <p>
      우선순위 최상위권은 재표집에도 유지되므로{" "}
      <b className="text-ink">예산 배분 근거자료로 인용 가능한 수준</b>입니다. 지자체
      심의 자료에는 순위와 함께 신뢰구간·상위권 확률을 병기해 &ldquo;어디까지
      확신할 수 있는가&rdquo;를 투명하게 전달할 것을 제안합니다.
    </p>
  ),
};

/* ================================================================== */
/*  작은 프리미티브                                                    */
/* ================================================================== */

function StatusBadge({ status }: { status: ModelResult["status"] }) {
  if (status === "final")
    return (
      <span className="rounded bg-infra/15 px-1.5 py-0.5 text-[10px] font-semibold text-infra">
        확정
      </span>
    );
  if (status === "rehearsal")
    return (
      <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
        리허설
      </span>
    );
  return (
    <span className="rounded bg-warn/15 px-1.5 py-0.5 text-[10px] font-semibold text-warn">
      분석 대기
    </span>
  );
}

function OwnerChip({ owner, dim }: { owner: Owner; dim?: boolean }) {
  const m = OWNER_META[owner];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold"
      style={{
        borderColor: dim ? "var(--line)" : `${m.color}55`,
        background: dim ? "transparent" : `${m.color}14`,
        color: dim ? "var(--ink-dim)" : m.color,
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: dim ? "var(--ink-dim)" : m.color }}
      />
      {m.full}
    </span>
  );
}

const num = (v: number | string | undefined): number | null => {
  const n = Number(v);
  return v === undefined || Number.isNaN(n) ? null : n;
};

const TIME_BANDS: [string, number, number][] = [
  ["00-06시", 0, 6],
  ["06-11시", 6, 11],
  ["11-16시", 11, 16],
  ["16-24시", 16, 24],
];

/* ================================================================== */
/*  씬                                                                 */
/* ================================================================== */

export function ModelsScene({ onMapSpec }: { onMapSpec: (s: MapSpec) => void }) {
  const models = useData<ModelResult[]>(DATA.modelResults);
  const dongs = useData<DongCollection<DongProps>>(DATA.dongs);
  const stats = useData<Stats>(DATA.stats);
  const charts = useData<ModelCharts>(DATA.modelCharts);
  const deserts = useData<ArrivalDeserts>(DATA.arrivalDeserts);

  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);

  // 풀페이지 씬 — 지도는 쓰지 않으므로 이전 씬 레이어만 정리.
  useEffect(() => {
    onMapSpec({ layers: [] });
  }, [onMapSpec]);

  // 내러티브 순서로 정렬된 스텝 (모델 데이터와 STORY 결합, 미정의 모델은 뒤에 붙임).
  const steps = useMemo(() => {
    const byId = new Map((models.data ?? []).map((m) => [m.id, m]));
    const ordered: (StoryStep & { model: ModelResult })[] = [];
    for (const s of STORY) {
      const m = byId.get(s.id);
      if (m) {
        ordered.push({ ...s, model: m });
        byId.delete(s.id);
      }
    }
    for (const m of byId.values())
      ordered.push({
        id: m.id,
        short: m.name,
        question: m.name,
        owners: [],
        policyTitle: m.headline,
        bridge: "",
        model: m,
      });
    return ordered;
  }, [models.data]);

  const safeStep = steps.length ? Math.min(step, steps.length - 1) : 0;

  // 자동재생 — 스텝을 순환.
  useEffect(() => {
    if (!playing || steps.length < 2) return;
    const t = setInterval(
      () => setStep((s) => (s + 1) % steps.length),
      6800,
    );
    return () => clearInterval(t);
  }, [playing, steps.length]);

  // 방향키(← →)로 스텝 이동 — 입력창에 포커스가 없을 때만.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowRight") {
        setStep((s) => Math.min(steps.length - 1, s + 1));
        setPlaying(false);
      } else if (e.key === "ArrowLeft") {
        setStep((s) => Math.max(0, s - 1));
        setPlaying(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [steps.length]);

  // ---- KPI · 정책 파생값 ----
  const byId = useMemo(() => {
    const map: Record<string, ModelResult> = {};
    for (const m of models.data ?? []) map[m.id] = m;
    return map;
  }, [models.data]);

  const topGap5 = useMemo(() => {
    if (!dongs.data) return [];
    return [...dongs.data.features]
      .sort((a, b) => b.properties.gapScore - a.properties.gapScore)
      .slice(0, 5)
      .map((f) => f.properties);
  }, [dongs.data]);

  // ---- 근거 차트 데이터 ----
  const corr = useMemo(() => {
    const m = models.data?.find((x) => x.id === "correlation");
    const slope = num(m?.numbers?.slope);
    const intercept = num(m?.numbers?.intercept);
    if (!dongs.data || slope === null || intercept === null) return null;
    const pts: CorrPoint[] = dongs.data.features.map((f) => {
      const p = f.properties;
      return {
        x: Math.log10(p.shops + 1),
        y: Math.log10(p.dropoffs + 1),
        name: p.name,
        gu: p.gu,
        shops: p.shops,
        dropoffs: p.dropoffs,
        top: false,
      };
    });
    const byResid = [...pts].sort(
      (a, b) =>
        b.y - (intercept + slope * b.x) - (a.y - (intercept + slope * a.x)),
    );
    byResid.slice(0, 4).forEach((p) => (p.top = true));
    return { points: pts, slope, intercept };
  }, [dongs.data, models.data]);

  const irrRows = useMemo((): IrrRow[] | null => {
    const nb = models.data?.find((x) => x.id === "nb-regression")?.numbers;
    if (!nb) return null;
    const defs: [string, string][] = [
      ["chargers", "충전소 +1기"],
      ["medical", "병의원·약국 +1"],
      ["welfare", "복지시설 +1"],
      ["floor1Share", "1층 상가 비율"],
    ];
    const rows: IrrRow[] = [];
    for (const [key, label] of defs) {
      const irr = num(nb[`irr_${key}`]);
      const lo = num(nb[`irr_${key}_lo`]);
      const hi = num(nb[`irr_${key}_hi`]);
      if (irr === null || lo === null || hi === null) continue;
      rows.push({ label, irr, lo, hi, significant: lo > 1 || hi < 1 });
    }
    return rows.length ? rows : null;
  }, [models.data]);

  const bands = useMemo(() => {
    const s = stats.data;
    if (!s) return null;
    const rows = TIME_BANDS.map(([band, h0, h1]) => {
      let req = 0;
      let una = 0;
      for (let h = h0; h < h1; h++) {
        req += s.hourly[h].requests;
        una += s.hourly[h].unassigned;
      }
      return { band, requests: req, rate: req ? una / req : 0 };
    });
    return { rows, overall: s.totals.unassignedRate };
  }, [stats.data]);

  const gapTop = useMemo((): GapCiRow[] | null => {
    if (!dongs.data) return null;
    return [...dongs.data.features]
      .sort((a, b) => b.properties.gapScore - a.properties.gapScore)
      .slice(0, 8)
      .map((f) => ({
        name: f.properties.name,
        gu: f.properties.gu,
        gap: f.properties.gapScore,
        ci: f.properties.gapCI,
        pTop5: f.properties.pTop5,
      }));
  }, [dongs.data]);

  const chartFor = (m: ModelResult): ReactNode => {
    switch (m.id) {
      case "retry-funnel": {
        const requests = num(m.numbers?.requests);
        const unmet = num(m.numbers?.unmet);
        const retried = num(m.numbers?.retried);
        const abandoned = num(m.numbers?.abandoned);
        if (!requests || !unmet || retried === null || abandoned === null)
          return null;
        return (
          <FunnelBars
            requests={requests}
            unmet={unmet}
            retried={retried}
            abandoned={abandoned}
          />
        );
      }
      case "correlation":
        return corr ? (
          <CorrScatter
            points={corr.points}
            slope={corr.slope}
            intercept={corr.intercept}
          />
        ) : null;
      case "nb-regression":
        return irrRows ? <IrrForest rows={irrRows} /> : null;
      case "chi-square-type-purpose":
        return charts.data ? (
          <TypePurposeHeat {...charts.data.typePurpose} />
        ) : null;
      case "welch-t":
        return charts.data ? <WaitHistCompare {...charts.data.waitHist} /> : null;
      case "chi-square":
        return bands ? (
          <BandUnmetBar bands={bands.rows} overall={bands.overall} />
        ) : null;
      case "bootstrap-stability":
        return gapTop ? <GapCiTop rows={gapTop} /> : null;
      default:
        return null;
    }
  };

  if (!models.data) {
    return (
      <DataPending note="model_results.json 대기 중 — 본선에서 데이터 분석 결과가 이 흐름에 채워집니다." />
    );
  }

  const anyRehearsal = models.data.some((m) => m.status === "rehearsal");
  const jumpTo = (id: string) => {
    const i = steps.findIndex((s) => s.id === id);
    if (i >= 0) {
      setStep(i);
      setPlaying(false);
    }
  };

  // KPI 스트립 값
  const abandoned = num(byId["retry-funnel"]?.numbers?.abandoned);
  const retryGap = byId["retry-funnel"]?.numbers?.median_retry_gap_min;
  const worstBandRate = num(byId["chi-square"]?.numbers?.worst_band_rate);
  const irrChargers = num(byId["nb-regression"]?.numbers?.irr_chargers);
  const top1 = topGap5[0];

  const KPIS: {
    label: string;
    value: string;
    sub: string;
    color: string;
    jump: string;
  }[] = [
    {
      label: "사라진 외출 (월, 포기 추정)",
      value: abandoned !== null ? `${fmt(abandoned)}건` : "—",
      sub: `재접수 간격 중앙값 ${retryGap ?? "—"}분`,
      color: HEX.unmet,
      jump: "retry-funnel",
    },
    {
      label: "저녁(16–24시) 미배차율",
      value: worstBandRate !== null ? pct(worstBandRate) : "—",
      sub: "전체 평균 9.4%의 1.7배",
      color: HEX.warn,
      jump: "chi-square",
    },
    {
      label: "충전소 +1기 연관 효과",
      value: irrChargers !== null ? `×${irrChargers.toFixed(2)}` : "—",
      sub: "상권 통제 후에도 유의 (IRR)",
      color: HEX.accent,
      jump: "nb-regression",
    },
    {
      label: "개선 우선 1순위",
      value: top1 ? top1.name : "—",
      sub: top1 ? `${top1.gu} · P(상위5) ${pct(top1.pTop5 ?? 0, 0)}` : "",
      color: HEX.gapHL,
      jump: "bootstrap-stability",
    },
  ];

  const cur = steps[safeStep];
  const m = cur.model;
  const chart = chartFor(m);
  const progress = steps.length > 1 ? safeStep / (steps.length - 1) : 0;

  return (
    <div className="space-y-4">
      {/* ── 히어로 ─────────────────────────────────────────────── */}
      <div
        className="animate-rise-in relative overflow-hidden rounded-xl border border-accent/25 bg-gradient-to-br from-[#18202f] via-panel to-[#0e1422] px-5 py-4"
        style={{ animationDelay: "0ms" }}
      >
        <div
          className="pointer-events-none absolute -right-14 -top-16 h-52 w-52 rounded-full opacity-20 blur-3xl"
          style={{ background: HEX.accent }}
        />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[17px] font-bold leading-6 text-ink">
                데이터가 정책이 되기까지
              </span>
              <span className="rounded-full border border-accent/50 bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent">
                {steps.length}단계 흐름
              </span>
              {anyRehearsal && (
                <span className="rounded-full border border-warn/40 bg-warn/10 px-2 py-0.5 text-[10px] font-semibold text-warn">
                  리허설 데이터 기준
                </span>
              )}
            </div>
            <p className="mt-1 text-[12.5px] leading-5 text-ink/80">
              하나의 분석이 하나의 정책을 낳고, 그 정책이 다시 다음 질문으로
              이어집니다 — 모든 판단은 데이터가 허락하는 만큼만.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-[12px] font-semibold transition ${
                playing
                  ? "border-accent bg-accent/25 text-accent"
                  : "border-accent/40 bg-accent/10 text-accent hover:bg-accent/20"
              }`}
            >
              <span className="text-[11px]">{playing ? "❚❚" : "▶"}</span>
              {playing ? "재생 중" : "자동 재생"}
            </button>
            <div className="tnum rounded-lg border border-line bg-[#1a2338] px-3 py-2 text-[12px] text-dim">
              <span className="text-[15px] font-bold text-ink">
                {String(safeStep + 1).padStart(2, "0")}
              </span>
              {" / "}
              {String(steps.length).padStart(2, "0")}
            </div>
          </div>
        </div>
        {/* 진행 바 */}
        <div className="relative mt-3 h-1.5 overflow-hidden rounded-full bg-[#0d1424]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-demand to-accent transition-[width] duration-500"
            style={{ width: `${progress * 100}%` }}
          />
          {playing && (
            <div
              key={safeStep}
              className="absolute inset-y-0 left-0 w-full origin-left bg-accent/30"
              style={{ animation: "autoplay-bar 6.8s linear forwards" }}
            />
          )}
        </div>
      </div>

      {/* ── 이 화면 읽는 법 (항상 펼쳐진 안내) ─────────────────── */}
      <div
        className="animate-rise-in rounded-xl border border-accent/30 bg-panel px-4 py-3.5"
        style={{ animationDelay: "50ms" }}
      >
        <div className="mb-2.5 flex flex-wrap items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/20 text-[11px] font-bold text-accent">
            ?
          </span>
          <span className="text-[13px] font-bold text-ink">이 화면 읽는 법</span>
          <span className="text-[11.5px] text-dim">
            — 하나의 분석 → 하나의 정책으로 이어지는 흐름을 따라가세요
          </span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              n: "1",
              c: HEX.accent,
              t: "눌러서 이동",
              d: "아래 흐름의 ①~⑦ 노드나 숫자 카드를 클릭 · ▶ 자동 재생도 가능",
            },
            {
              n: "2",
              c: HEX.demand,
              t: "왼쪽 = 분석",
              d: "‘무엇이 사실인가’ — 데이터·차트와 누구나 읽는 쉬운 해석",
            },
            {
              n: "3",
              c: HEX.accent,
              t: "오른쪽 = 그래서",
              d: "그 사실이 낳는 정책 제안 + 실행주체(공단·구청·윌체어)",
            },
            {
              n: "4",
              c: HEX.tourism,
              t: "맨 아래 = 종합",
              d: "주체별 실행안을 한눈에 — 각 제안이 어느 분석에서 나왔는지 연결",
            },
          ].map((g) => (
            <div
              key={g.n}
              className="flex gap-2.5 rounded-lg border border-line bg-[#0e1424] px-3 py-2.5"
            >
              <span
                className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-bg"
                style={{ background: g.c }}
              >
                {g.n}
              </span>
              <div>
                <div className="text-[12px] font-semibold leading-4 text-ink">
                  {g.t}
                </div>
                <div className="mt-1 text-[11px] leading-4 text-dim">{g.d}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 플로우 타임라인 (가장 먼저 보이도록 상단 배치) ─────── */}
      <div
        className="animate-rise-in rounded-xl border border-line bg-panel px-4 py-3.5"
        style={{ animationDelay: "110ms" }}
      >
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-ink/80">
            분석 흐름 — 눌러서 이동
          </span>
          <span className="text-[10px] text-dim">← → 방향키로도 이동</span>
        </div>
        <div className="flex items-start">
          {steps.map((s, i) => {
            const done = i < safeStep;
            const active = i === safeStep;
            return (
              <div key={s.id} className="flex flex-1 flex-col items-center">
                <div className="flex w-full items-center">
                  {/* 왼쪽 연결선 */}
                  <div
                    className={`h-[3px] flex-1 rounded-full ${i === 0 ? "opacity-0" : ""} ${
                      i <= safeStep ? "bg-accent" : "bg-line"
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setStep(i);
                      setPlaying(false);
                    }}
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[12px] font-bold transition ${
                      active
                        ? "scale-110 border-accent bg-accent text-bg shadow-[0_0_0_5px] shadow-accent/25"
                        : done
                          ? "border-accent/70 bg-accent/20 text-accent"
                          : "border-line bg-[#1a2338] text-dim hover:border-accent/60 hover:text-ink"
                    }`}
                  >
                    {i + 1}
                  </button>
                  {/* 오른쪽 연결선 */}
                  <div
                    className={`h-[3px] flex-1 rounded-full ${
                      i === steps.length - 1 ? "opacity-0" : ""
                    } ${i < safeStep ? "bg-accent" : "bg-line"}`}
                  />
                </div>
                <span
                  className={`mt-2 text-center text-[10.5px] leading-3 ${
                    active ? "font-bold text-accent" : "text-dim"
                  }`}
                >
                  {s.short}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── KPI 스트립 (클릭 → 해당 분석으로 점프) ─────────────── */}
      <div
        className="animate-rise-in grid grid-cols-2 gap-3 lg:grid-cols-4"
        style={{ animationDelay: "170ms" }}
      >
        {KPIS.map((k) => {
          const active = cur.id === k.jump;
          return (
            <button
              key={k.label}
              type="button"
              onClick={() => jumpTo(k.jump)}
              className={`rounded-lg border px-3.5 py-3 text-left transition ${
                active
                  ? "border-accent/70 bg-[#1a2745] ring-1 ring-accent/40"
                  : "border-line bg-[#161e30] hover:border-accent/40 hover:bg-[#1a2338]"
              }`}
            >
              <div
                className="mb-2 h-1 w-7 rounded-full"
                style={{ background: k.color }}
              />
              <div className="text-[11px] leading-4 text-dim">{k.label}</div>
              <div className="tnum mt-0.5 text-[22px] font-bold leading-7 text-ink">
                {k.value}
              </div>
              {k.sub && (
                <div className="tnum mt-0.5 text-[11px] leading-4 text-dim">
                  {k.sub}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* ── 스테이지: 분석 → 그래서 → 정책 ──────────────────────── */}
      <div key={safeStep} className="animate-stage-in">
        <div className="grid items-stretch gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          {/* 좌: 분석 (근거) */}
          <section className="relative overflow-hidden rounded-xl border border-line bg-panel">
            <div
              className="absolute inset-y-0 left-0 w-1 rounded-l-xl"
              style={{ background: HEX.demand }}
            />
            <header className="flex items-center justify-between border-b border-line/70 px-4 py-3 pl-5">
              <div>
                <div className="flex items-center gap-2">
                  <span className="tnum text-[11px] font-bold text-demand">
                    분석 {String(safeStep + 1).padStart(2, "0")}
                  </span>
                  <span className="text-[13px] font-bold leading-5 text-ink">
                    {m.name}
                  </span>
                </div>
                <div className="mt-0.5 text-[11.5px] leading-4 text-dim">
                  Q. {cur.question}
                </div>
              </div>
              <StatusBadge status={m.status} />
            </header>

            <div className="space-y-3 px-4 py-3 pl-5">
              {/* 사실 */}
              <div>
                <div className="mb-1 text-[9px] font-bold uppercase tracking-[0.16em] text-dim/75">
                  사실
                </div>
                <p
                  className={`text-[13.5px] font-semibold leading-5 ${
                    m.status === "placeholder" ? "text-dim" : "text-ink"
                  }`}
                >
                  {m.headline}
                </p>
                <p className="mt-1 text-[11.5px] leading-[18px] text-dim">
                  {m.detail}
                </p>
              </div>

              {/* 시각화 */}
              {chart && (
                <div>
                  <div className="mb-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-dim/75">
                    시각화
                  </div>
                  {chart}
                </div>
              )}

              {/* 해석 */}
              {INTERPRET[m.id] && (
                <div>
                  <div className="mb-1 text-[9px] font-bold uppercase tracking-[0.16em] text-demand/80">
                    쉽게 읽으면
                  </div>
                  <div className="rounded-md border border-line bg-[#0e1424] px-3.5 py-3 text-[12.5px] leading-[19px] text-ink/90">
                    {INTERPRET[m.id]}
                  </div>
                </div>
              )}

              {/* 원 수치 */}
              {m.numbers && Object.keys(m.numbers).length > 0 && (
                <details>
                  <summary className="cursor-pointer select-none text-[10.5px] text-dim hover:text-ink">
                    원 수치 보기 (계수 · p값 · 신뢰구간)
                  </summary>
                  <table className="mt-1.5 w-full text-[11px]">
                    <tbody>
                      {Object.entries(m.numbers).map(([k, v]) => (
                        <tr key={k} className="border-t border-line/60">
                          <td className="py-1 pr-2 text-dim">{k}</td>
                          <td className="tnum py-1 text-right text-ink">
                            {String(v)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )}
            </div>
          </section>

          {/* 우: 정책 (판단) */}
          <section className="relative flex flex-col overflow-hidden rounded-xl border border-accent/40 bg-panel">
            {/* "그래서" 연결 뱃지 — 좌 패널에서 넘어온다는 시각 신호 */}
            <div className="absolute -left-3 top-1/2 z-10 hidden -translate-y-1/2 lg:block">
              <div className="flex h-6 w-6 items-center justify-center rounded-full border border-accent/60 bg-[#132033] text-[11px] font-bold text-accent shadow-[0_0_0_3px] shadow-accent/15">
                →
              </div>
            </div>
            <header className="relative border-b border-accent/25 bg-accent/[0.06] px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-accent">
                  그래서 — 정책 제안
                </span>
              </div>
              <div className="mt-1 text-[14px] font-bold leading-5 text-ink">
                {cur.policyTitle}
              </div>
              {cur.owners.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {cur.owners.map((o) => (
                    <OwnerChip key={o} owner={o} />
                  ))}
                </div>
              )}
            </header>

            <div className="relative flex-1 space-y-3 px-4 py-3">
              {POLICY[m.id] && (
                <div className="text-[12.5px] leading-[19px] text-ink/90">
                  {POLICY[m.id]}
                </div>
              )}

              {/* 경계 */}
              {m.caveats && (
                <div className="rounded-md border border-warn/30 bg-warn/[0.10] px-3 py-2.5">
                  <div className="mb-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-warn">
                    경계 — 발표 때 반드시
                  </div>
                  <p className="text-[11px] leading-[17px] text-warn/90">
                    {m.caveats}
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* ── 브릿지: 다음 질문 ─────────────────────────────────── */}
        {cur.bridge && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/25 bg-[#0e1424] px-4 py-3">
            <div className="flex items-center gap-2.5">
              <span className="animate-flow-pulse text-[15px] text-accent">↳</span>
              <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-accent">
                {safeStep === steps.length - 1 ? "결론" : "다음 질문"}
              </span>
              <span className="text-[12.5px] leading-5 text-ink/90">
                {cur.bridge}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setStep((s) => Math.max(0, s - 1));
                  setPlaying(false);
                }}
                disabled={safeStep === 0}
                className="rounded-md border border-line px-3 py-1.5 text-[11.5px] text-dim transition hover:text-ink disabled:opacity-30"
              >
                ← 이전
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep((s) => Math.min(steps.length - 1, s + 1));
                  setPlaying(false);
                }}
                disabled={safeStep === steps.length - 1}
                className="rounded-md border border-accent/50 bg-accent/10 px-3 py-1.5 text-[11.5px] font-semibold text-accent transition hover:bg-accent/20 disabled:opacity-30"
              >
                다음 분석 →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── 종합: 실행주체별 누적 제안 ──────────────────────────── */}
      <div className="animate-rise-in" style={{ animationDelay: "210ms" }}>
        <div className="mb-2 flex items-center gap-2 px-0.5">
          <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-ink/80">
            종합 — 세 실행주체의 실행안
          </span>
          <span className="text-[10px] text-dim">
            (진행 중인 분석이 기여하는 칸은 강조)
          </span>
        </div>
        <div className="grid items-start gap-3 lg:grid-cols-3">
          {OWNER_ORDER.map((owner) => {
            const meta = OWNER_META[owner];
            const items = steps
              .map((s, i) => ({ s, i }))
              .filter(({ s }) => s.owners.includes(owner));
            const contributesNow = cur.owners.includes(owner);
            return (
              <section
                key={owner}
                className={`overflow-hidden rounded-xl border bg-panel transition ${
                  contributesNow ? "border-accent/50" : "border-line"
                }`}
              >
                <header className="border-b border-line/70 px-3.5 py-2.5">
                  <div
                    className="mb-1.5 h-1 w-8 rounded-full"
                    style={{ background: meta.color }}
                  />
                  <div className="flex items-center justify-between">
                    <h3 className="text-[13px] font-bold leading-5 text-ink">
                      {meta.full}
                    </h3>
                    <span className="tnum text-[10px] text-dim">
                      제안 {items.length}
                    </span>
                  </div>
                  <div className="text-[11px] leading-4 text-dim">
                    {meta.role}
                  </div>
                </header>
                <ul className="space-y-1.5 px-3 py-3">
                  {items.map(({ s, i }) => {
                    const isNow = i === safeStep;
                    return (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setStep(i);
                            setPlaying(false);
                          }}
                          className={`flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left transition ${
                            isNow
                              ? "border-accent/50 bg-accent/[0.12]"
                              : "border-line bg-[#0e1424] hover:border-accent/40 hover:bg-[#141d2e]"
                          }`}
                        >
                          <span
                            className={`tnum mt-px text-[10px] font-bold ${
                              isNow ? "text-accent" : "text-dim"
                            }`}
                          >
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <span
                            className={`text-[11.5px] leading-4 ${
                              isNow ? "text-ink" : "text-ink/85"
                            }`}
                          >
                            {s.policyTitle}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      </div>

      <div className="animate-rise-in" style={{ animationDelay: "280ms" }}>
      <Explainer
        what={
          <>
            <p>
              지도 씬들이 내놓은 주장 — 미충족 수요의 규모, 시간대 편중, 휠체어
              유형별 형평, 인프라와 수요의 연관, 장애유형별 이동 패턴, 우선순위의
              신뢰도 — 를 각각 표준 통계 기법으로 검증하고, 각 결과가 어떤 정책
              제안으로 이어지는지를 하나의 흐름으로 엮은 화면입니다. 상단
              타임라인의 노드를 누르거나 자동 재생으로 &ldquo;분석 →
              정책&rdquo;의 연쇄를 순서대로 따라갈 수 있습니다.
            </p>
            <p className="mt-2">
              <b>어떻게 활용하나</b> — 공단·구청·윌체어가 이 대시보드의 순위나
              시뮬레이션을 근거로 예산을 움직이려면 &ldquo;그 수치를 믿을 수
              있는가&rdquo;에 대한 답이 필요합니다. 이 흐름이 그 답이며, 하단
              종합표는 세 실행주체별로 어떤 제안이 어떤 분석에서 나왔는지를 모아
              보여줍니다.
            </p>
          </>
        }
        how={
          <>
            <p>
              깔때기는 미충족 접수 뒤 같은 ~100m 지점의 60분 내 재접수 여부를
              센 것입니다. 시간대 카이제곱은 &ldquo;시간대와 미배차가
              무관하다&rdquo;, Welch t는 로그 변환 후 수동 vs 전동 평균 대기
              비교, 상관 카드는 log-log 피어슨 상관·단순회귀와 그 잔차, 음이항
              회귀는 동별 하차를 셈 데이터로 놓고 과산포를 보정한 모델(계수는
              IRR로 읽음), 유형×목적 카이제곱은 &ldquo;장애유형과 이동 목적이
              무관하다&rdquo;, 부트스트랩은 날짜 단위 500회 재표집으로 순위 흔들림을
              직접 세어본 것입니다. 모든 수치는 파이프라인이 쓴
              model_results.json·model_charts.json을 그대로 렌더링합니다.
            </p>
          </>
        }
        caveats={
          <>
            <p>
              배지가 &lsquo;리허설&rsquo;인 카드는 2025년 5월 부산시 전역 공개
              데이터로 적합한 실제 수치이지만, 본선 데이터(해운대구, 장기간)에서는
              값이 달라질 수 있습니다. 회귀·상관 결과는 전부{" "}
              <b>연관성이지 인과가 아니며</b>, 그래서 신뢰구간을 화면에 그대로
              노출합니다. 통계적 유의성(p값)과 실무적 중요성(효과 크기)은 다른
              개념이라, 각 카드에 효과 크기(d, Cramér&rsquo;s V)를 함께 적고 작으면
              작다고 밝혔습니다. 한 달치 데이터라는 근본 한계는 모든 카드에
              공통입니다.
            </p>
          </>
        }
        title="분석 방법 · 주의사항 자세히 보기 (통계 기법 · 한계)"
      />

      <p className="px-1 text-[10px] leading-4 text-dim">
        통계 수치는 model_results.json + model_charts.json, 정책 파생 수치는
        model_results · dongs · arrival_deserts에서 실시간으로 읽습니다 — 본선
        데이터 재계산 시 이 흐름 전체가 자동 갱신됩니다 (UI 수정 불필요). 모든
        결과는 정책 참고자료이며 추가 검증이 필요합니다(인과 아님 · 리허설 표본
        한계).
      </p>
      </div>
    </div>
  );
}
