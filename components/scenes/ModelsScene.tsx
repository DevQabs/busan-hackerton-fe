"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import { GeoJsonLayer } from "deck.gl";
import { DATA, type DongProps, type ModelResult } from "@/lib/types";
import { useData } from "@/lib/useData";
import { type DongCollection, type MapSpec } from "@/lib/mapspec";
import { Section } from "@/components/ui/Section";
import { DataPending } from "@/components/ui/DataPending";
import { Explainer } from "@/components/ui/Explainer";

/** Status badge — "rehearsal" numbers are real fits on May citywide data;
 *  "placeholder" kept for backward compat (pre-rehearsal pipeline output). */
function StatusBadge({ status }: { status: ModelResult["status"] }) {
  if (status === "final") {
    return (
      <span className="rounded bg-infra/15 px-1.5 py-0.5 font-semibold text-infra">
        확정
      </span>
    );
  }
  if (status === "rehearsal") {
    return (
      <span className="rounded bg-accent/15 px-1.5 py-0.5 font-semibold text-accent">
        리허설
      </span>
    );
  }
  return (
    <span className="rounded bg-warn/15 px-1.5 py-0.5 font-semibold text-warn">
      분석 대기
    </span>
  );
}

/** Plain-Korean interpretation per model card, written for a non-statistician
 *  judge. Keyed by model id so the JSON stays a pure results contract. */
const INTERPRET: Record<string, ReactNode> = {
  "nb-regression": (
    <>
      <p>
        <b className="text-ink">쉽게 읽으면</b> — 조건이 비슷한 두 동을
        비교했을 때, 급속충전기가 1기 더 있는 동은 하차가 약{" "}
        <b className="tnum text-ink">22% 더 많은 경향</b>이 있었습니다(IRR
        1.223, 95% 신뢰구간 1.100–1.360 — 구간이 1을 넘으므로 우연으로 보기
        어렵습니다). 이것은 <b>연관이지 인과가 아닙니다</b>: 충전기를 지으면
        하차가 22% 늘어난다는 뜻이 아니라, 충전기가 있는 곳에 전동휠체어
        이용자가 실제로 &ldquo;가고 있다&rdquo;는 뜻입니다. 반대로 이 모델이
        기대하는 것보다 이용이 훨씬 적은 동(강한 음의 잔차)은 잠재수요 의심
        지역으로 지도에 표시됩니다 — 관측 수요만 보면 놓치는 곳입니다.
        1층 상가 비율 변수는 신뢰구간이 1을 포함해(0.68–5.98) 이번 적합에서는
        유의하지 않았음을 그대로 밝힙니다.
      </p>
    </>
  ),
  "welch-t": (
    <>
      <p>
        <b className="text-ink">쉽게 읽으면</b> — 수동휠체어 이용자의 배차
        대기가 전동휠체어보다 평균적으로 약{" "}
        <b className="tnum text-ink">14% 길었습니다</b>. 표본이 커서(수동
        18,221건, 전동 6,322건) 통계적으로는 매우 유의하지만(t=5.63,
        p&lt;0.0001), 효과 크기 d=0.085는 관례상 &ldquo;작음&rdquo;에
        해당합니다. 정직하게 말하면{" "}
        <b>
          &ldquo;차이는 분명히 존재하지만, 실무적으로 큰 격차는 아니다&rdquo;
        </b>
        입니다. 배차 정책이 휠체어 유형을 크게 차별하고 있지는 않다는 점검
        결과로 읽는 것이 맞고, 이 차이의 원인(차량 리프트 사양, 지역 분포
        차이 등)은 본선 데이터에서 추가로 확인할 부분입니다.
      </p>
    </>
  ),
  "chi-square": (
    <>
      <p>
        <b className="text-ink">쉽게 읽으면</b> — 미배차가 하루 중 고르게
        발생한다면 시간대별 미배차율이 비슷해야 하는데, 실제로는{" "}
        <b className="tnum text-unmet">16–24시 접수의 15.9%</b>가 미배차로
        끝나 전체 평균 9.4%를 크게 웃돌았습니다(χ²=335, p&lt;0.0001 —
        우연이라 보기 매우 어려운 편중). 정책적 의미는 분명합니다:{" "}
        <b>증차 없이도 저녁 시간대 운전원 교대·차량 배치를 조정하는 것만으로
        미배차의 상당 부분을 줄일 여지</b>가 있습니다. 다만 전체 연관 강도
        (Cramér&rsquo;s V=0.094)는 작으므로, &ldquo;시간대가 미배차의 주
        원인&rdquo;이라고 과장하지는 않습니다 — 특정 시간대에 편중이
        집중된다는 진단으로 읽어야 합니다.
      </p>
    </>
  ),
  "bootstrap-stability": (
    <>
      <p>
        <b className="text-ink">쉽게 읽으면</b> — 우선순위 순위표는 한 달치
        데이터로 만든 것이라, &ldquo;데이터가 조금 달랐어도 같은 순위였을까?&rdquo;
        라는 질문에 답해야 합니다. 날짜 단위로 데이터를 500번 다시 뽑아 순위를
        재계산해 보니, 사상구 학장동은{" "}
        <b className="tnum text-ink">500번 모두 상위 5위 안</b>에 들었고
        (P(상위5)=1.000) gapScore 90% 신뢰구간도 [8.74, 9.98]로 다른 동과
        겹치지 않았습니다. 즉 이 순위표의 최상위권은 우연의 산물이 아니라{" "}
        <b>데이터를 흔들어도 유지되는 안정적인 결론</b>입니다. 각 동의
        신뢰구간과 상위 5위 진입 확률은 &lsquo;우선순위&rsquo; 씬의 순위표에
        함께 표시됩니다.
      </p>
    </>
  ),
};

export function ModelsScene({ onMapSpec }: { onMapSpec: (s: MapSpec) => void }) {
  const models = useData<ModelResult[]>(DATA.modelResults);
  const dongs = useData<DongCollection<DongProps>>(DATA.dongs);

  // Quiet context map — dong outlines only; this scene lives in the panel.
  const layers = useMemo(() => {
    if (!dongs.data) return [];
    return [
      new GeoJsonLayer<DongProps>({
        id: "models-dongs",
        data: dongs.data as never,
        stroked: true,
        filled: true,
        getFillColor: [18, 24, 38, 60],
        getLineColor: [35, 43, 61, 180],
        getLineWidth: 1,
        lineWidthUnits: "pixels",
      }),
    ];
  }, [dongs.data]);

  useEffect(() => {
    onMapSpec({ layers });
  }, [layers, onMapSpec]);

  if (!models.data) {
    return (
      <DataPending note="model_results.json 대기 중 — 본선에서 데이터 분석 결과 카드가 이 자리에 채워집니다." />
    );
  }

  const anyRehearsal = models.data.some((m) => m.status === "rehearsal");

  return (
    <div className="space-y-3">
      <Section title="이 씬의 역할">
        <p className="text-[12px] leading-5 text-ink/85">
          대시보드의 다른 씬들이 &ldquo;무엇이 보이는가&rdquo;를 지도로
          말한다면, 이 씬은 <b className="text-ink">그 주장이 통계적으로
          버티는가</b>를 검증한 결과입니다. 네 개의 표준 기법 — 음이항 회귀,
          Welch t-검정, 카이제곱 독립성 검정, 부트스트랩 재표집 — 을 각각
          &ldquo;인프라와 수요의 연관&rdquo;, &ldquo;휠체어 유형별 형평&rdquo;,
          &ldquo;시간대 편중&rdquo;, &ldquo;순위의 신뢰도&rdquo;라는 질문에
          대응시켰습니다. 신뢰구간과 효과 크기를 숨기지 않고 그대로
          보여줍니다 — 유의하지 않은 결과도 유의하지 않다고 적습니다.
        </p>
      </Section>

      {models.data.map((m) => (
        <Section key={m.id} title={m.name} aside={<StatusBadge status={m.status} />}>
          <p
            className={`text-[13px] font-semibold leading-5 ${
              m.status === "placeholder" ? "text-dim" : "text-ink"
            }`}
          >
            {m.headline}
          </p>
          <p className="mt-1.5 text-[12px] leading-5 text-dim">{m.detail}</p>

          {INTERPRET[m.id] && (
            <div className="mt-2 rounded-md border border-line bg-[#0e1424] px-3 py-2.5 text-[12px] leading-5 text-ink/80">
              {INTERPRET[m.id]}
            </div>
          )}

          {m.numbers && Object.keys(m.numbers).length > 0 && (
            <table className="mt-2.5 w-full text-[11px]">
              <tbody>
                {Object.entries(m.numbers).map(([k, v]) => (
                  <tr key={k} className="border-t border-line/60">
                    <td className="py-1 pr-2 text-dim">{k}</td>
                    <td className="tnum py-1 text-right text-ink">{String(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {m.caveats && (
            <p className="mt-2 text-[11px] leading-4 text-warn/90">
              한계: {m.caveats}
            </p>
          )}
        </Section>
      ))}

      {anyRehearsal && (
        <Section title="본선에서 할 일">
          <ul className="list-disc space-y-1 pl-4 text-[12px] leading-5 text-dim">
            <li>
              음이항 회귀의 노출(exposure)을 프록시(상가수+1)에서{" "}
              <b className="text-ink">행정동별 장애인등록 인구</b>로 교체해
              재적합 — 잠재수요 지수(suppressedZ)도 함께 갱신.
            </li>
            <li>
              네 분석 모두 <b className="text-ink">해운대구 본선 데이터</b>
              (약 1년치)로 재계산하고, 부트스트랩 클러스터 단위를 일→주로
              재검토(기간이 길어지므로).
            </li>
            <li>
              미배차 식별 방식(상태 플래그 또는 결측 타임스탬프)을 Day 1에
              확정하고 카이제곱·생존분석의 분기 결정.
            </li>
            <li>
              재계산 결과는 model_results.json 교체만으로 이 화면에 반영 —
              UI 수정 불필요.
            </li>
          </ul>
        </Section>
      )}

      <Explainer
        what={
          <>
            <p>
              지도 씬들이 내놓은 네 가지 주장 — ① 인프라가 있는 곳으로
              수요가 간다, ② 휠체어 유형에 따른 대기 격차는 크지 않다,
              ③ 저녁 시간대에 미배차가 편중된다, ④ 우선순위 순위표의
              최상위권은 안정적이다 — 을 각각 표준 통계 기법으로 검증한
              결과 카드입니다. 카드마다 원 수치(계수·p값·신뢰구간)와
              함께 비전문가용 해석(&ldquo;쉽게 읽으면&rdquo;)을 붙였습니다.
            </p>
            <p className="mt-2">
              <b>어떻게 활용하나</b> — 공단·구청이 이 대시보드의 순위나
              시뮬레이션을 근거로 예산을 움직이려면 &ldquo;그 수치를 믿을 수
              있는가&rdquo;에 대한 답이 필요합니다. 이 씬이 그 답이고,
              발표·질의응답에서 방법론 공격을 받는 지점이기도 합니다.
              카드의 배지(리허설/확정)로 어느 데이터 기준의 수치인지 즉시
              구분할 수 있습니다.
            </p>
          </>
        }
        how={
          <>
            <p>
              음이항 회귀는 동별 하차 건수를 셈 데이터로 놓고 과산포를
              보정한 모델이며, 계수는 IRR(배수)로 읽습니다 — 노출 대비
              하차율이 몇 배가 되는가. Welch t는 두 집단의 분산이 달라도
              쓸 수 있는 평균 비교 검정으로, 대기시간의 치우친 분포를
              로그 변환 후 비교했습니다. 카이제곱은 &ldquo;시간대와 미배차가
              무관하다&rdquo;는 가설을 기각할 수 있는지 보는 검정입니다.
              부트스트랩은 날짜를 단위로 데이터를 500번 재표집해 순위가
              얼마나 흔들리는지 직접 세어본 것입니다. 모든 수치는 파이프라인이
              쓴 model_results.json을 그대로 렌더링하며, 본선 재계산 시 파일
              교체만으로 갱신됩니다.
            </p>
          </>
        }
        caveats={
          <>
            <p>
              현재 배지가 &lsquo;리허설&rsquo;인 카드는 2025년 5월 부산시
              전역 공개 데이터로 적합한 실제 수치이지만, 본선 데이터(해운대구,
              장기간)에서는 값이 달라질 수 있습니다. 회귀 결과는 전부{" "}
              <b>연관성이지 인과가 아니며</b>, 그래서 신뢰구간을 화면에
              그대로 노출합니다. 통계적 유의성(p값)과 실무적 중요성(효과
              크기)은 다른 개념입니다 — 표본이 크면 사소한 차이도
              유의해지므로, 각 카드에 효과 크기(d, Cramér&rsquo;s V)를 함께
              적고 작으면 작다고 밝혔습니다. 한 달치 데이터라는 근본 한계는
              모든 카드에 공통입니다.
            </p>
          </>
        }
      />

      <p className="px-1 text-[10px] leading-4 text-dim">
        카드 내용은 model_results.json을 그대로 렌더링합니다 — 본선 당일 데이터
        분석 결과로 교체됩니다 (UI 수정 불필요).
      </p>
    </div>
  );
}
