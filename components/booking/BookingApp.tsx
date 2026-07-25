"use client";

// 배차 예약 — 예상 대기시간 우선 + 목적지 접근성 시설 근접성.
//
// A booking EXPERIENCE, not a booking transaction: nothing is persisted and
// there is no backend beyond the two stateless Kakao proxies (app/api/places,
// app/api/directions). AGENTS.md's "no backend" rule holds for state; those
// routes exist only because the Kakao REST key must never reach the browser.
//
// Layout is one responsive tree, not two: mobile stacks form → wait → map →
// facilities, and at lg: the results become a scrolling column beside a sticky
// map. Same components, same data, both resolutions.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { IconLayer, PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import { MapCanvas } from "@/components/MapCanvas";
import { BottomTabBar } from "@/components/BottomTabBar";
import { PlaceInput, type VoiceHandle } from "./PlaceInput";
import { MicButton } from "./MicButton";
import { MicIcon } from "./MicIcon";
import { AccessTagList, ChainLine, FixLine, VerdictBadge } from "./AccessTagList";
import {
  parseSpokenHour,
  particleRo,
  speak,
  speechOutputSupported,
  spokenDistance,
  spokenPercent,
  stopSpeaking,
  useVoiceInput,
} from "@/lib/voice";
import { useData } from "@/lib/useData";
import { kakaoMapUrl, type KakaoPlace } from "@/lib/kakao";
import { fetchRoute, type RouteResult } from "@/lib/directions";
import { lookupWait, type WaitEstimate } from "@/lib/dongEta";
import {
  FACILITY_LABEL,
  FACILITY_ORDER,
  HAEUNDAE_ONLY_KINDS,
  formatDistance,
  formatDuration,
  groupNearbyShops,
  nearestByKind,
  type FacilityKind,
  type GroupedShops,
  type NearbyShop,
  type NearestFacility,
} from "@/lib/proximity";
import { FIT_HEX, FIT_LABEL, type Chair, type Fit } from "@/lib/wheelchair";
import {
  DATA,
  type AccessActions,
  type DispatchEtaData,
  type DongProps,
  type HaeundaeFacilities,
  type InfraPoint,
} from "@/lib/types";
import type { DongCollection } from "@/lib/mapspec";
import { tooltipHtml } from "@/lib/mapspec";

const ORIGIN_HEX = "#38bdf8"; // --demand
const DEST_HEX = "#22d3ee"; // --accent

const CHAIR_LABEL: Record<Chair, string> = {
  none: "해당 없음",
  manual: "수동 휠체어",
  electric: "전동 휠체어",
};

/** 휠체어 탑승은 리프트 고정 시간이 붙는다 — DispatchScene과 동일한 계수. */
const CHAIR_WAIT: Record<Chair, number> = {
  none: 1,
  manual: 1.08,
  electric: 1.18,
};

const FACILITY_HEX: Record<FacilityKind, string> = {
  toilet: "#60a5fa",
  charger: "#34d399",
  parking: "#c084fc",
  elevator: "#2dd4bf",
  welfare: "#a78bfa",
  tourism: "#fbbf24",
  hospital: "#f472b6",
};

/** 지도 마커 = 이모지. 색 점 6개는 범례 없이는 구분이 안 되지만, 그림은 바로 읽힌다. */
const FACILITY_EMOJI: Record<FacilityKind, string> = {
  toilet: "🚻",
  charger: "🔌",
  parking: "🅿️",
  elevator: "🛗",
  welfare: "🤝",
  tourism: "📷",
  hospital: "🏥",
};

const EMOJI_FONT =
  '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif';

/** 무장애 식당도 같은 이모지 마커로 찍는다. */
const SHOP_EMOJI = "🍽️";

const MARKER_PX = 96; // 굽는 해상도. 표시 크기(26px)보다 크게 잡아 확대 시 뭉개짐 방지.

/** 화면 표시 크기. 읽히려면 이 정도는 되어야 하고, 그래서 겹침을 따로 푼다. */
const MARKER_SIZE = 26;

const markerCache = new Map<string, string>();

/** 마커 하나를 캔버스에 그려 data URL로 굽는다 — IconLayer의 아이콘 원본.
 *
 *  TextLayer로는 컬러 이모지를 그릴 수 없다. 폰트 아틀라스의 알파 채널만 샘플링해
 *  getColor로 칠하는 구조라 색이 전부 날아가고, 내부 디테일도 알파에 남지 않아
 *  🏥는 그냥 사각 덩어리가 된다. IconLayer는 텍스처 RGB를 그대로 쓰므로(mask:false)
 *  색이 살아난다 — 대신 아이콘을 우리가 직접 래스터화해서 넘겨야 한다.
 *
 *  캔버스 fillText는 폰트 폴백을 그대로 타므로 코드포인트 개수를 신경 쓸 필요가
 *  없다 — 🅿️(U+1F17F+U+FE0F)처럼 변형 선택자가 붙어도 정상 렌더된다.
 *
 *  받침도 테두리도 없이 이모지만 그린다. 다만 밝은 basemap 위에서 이모지가 묻히므로
 *  그림자만 남겼다 — 상자가 아니라 글리프 외곽을 따라가므로 눈에 띄지 않는다. */
function emojiMarkerUrl(emoji: string): string {
  const hit = markerCache.get(emoji);
  if (hit) return hit;

  const canvas = document.createElement("canvas");
  canvas.width = MARKER_PX;
  canvas.height = MARKER_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 9;
  ctx.font = `${Math.round(MARKER_PX * 0.72)}px ${EMOJI_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, MARKER_PX / 2, MARKER_PX / 2);

  const url = canvas.toDataURL();
  markerCache.set(emoji, url);
  return url;
}

/** 호버 시 살짝 커지는 배율. 겹친 마커 중 어느 것을 집었는지 알려주는 신호이지,
 *  장식이 아니다 — 그래서 아주 약간만. */
const MARKER_HOVER_SCALE = 1.18;

export default function BookingApp() {
  const [origin, setOrigin] = useState<KakaoPlace | null>(null);
  const [dest, setDest] = useState<KakaoPlace | null>(null);
  const [hour, setHour] = useState(() => new Date().getHours());
  // 기본값이 "none"인 이유: 음성 흐름의 사용자는 시각장애인이고, 거기에 수동 휠체어까지
  // 겹치면 페르소나가 복잡해진다. 그리고 chair가 "none"이면 wheelchairFit이 판정 자체를
  // 건너뛰므로(lib/wheelchair.ts:73), 낭독에서 "이용 가능 N곳"처럼 하지도 않은 판정을
  // 말하지 않게 된다. 휠체어 이용자는 아래 토글로 직접 고른다.
  const [chair, setChair] = useState<Chair>("none");
  /** 선택된 업종. 빈 배열 = 전체 */
  const [catFilter, setCatFilter] = useState<string[]>([]);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routing, setRouting] = useState(false);
  /** 마우스가 올라간 마커의 키. null = 아무것도 안 올라감. */
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  /** 앱이 직접 결과를 낭독하는가. 기본 켬.
   *
   *  브라우저는 스크린리더가 켜져 있는지 알 수 없다 — 그래서 앱 TTS와 스크린리더가
   *  같은 문장을 겹쳐 읽는 상황을 코드로는 피할 수 없고, 이 토글이 유일한 해법이다.
   *  끄면 aria-live 영역만 남아 스크린리더 혼자 읽는다. */
  const [voiceOn, setVoiceOn] = useState(true);

  /** 음성 모드 — 화면 전체가 탭 면이 된다. `/booking?voice=1`로 바로 진입할 수 있다.
   *
   *  왜 모드로 가르는가: 화면을 못 보는 사람에게 버튼의 "위치"는 존재하지 않으므로 조작
   *  면은 화면 전체여야 한다. 그런데 그 동작을 일반 페이지에 그대로 넣으면 업종 칩·스크롤·
   *  지도 조작이 전부 죽는다. 그래서 켤 때만 켠다 — 페이지를 복제하지는 않는다. */
  const [voiceMode, setVoiceMode] = useState(false);
  /** 음성으로 채운 입력 개수 0..3. 화면의 "1 / 3 출발지" 표시와 탭 동작을 결정한다. */
  const [voiceStep, setVoiceStep] = useState(0);

  const originVoice = useRef<VoiceHandle | null>(null);
  const destVoice = useRef<VoiceHandle | null>(null);
  const hourVoice = useRef<VoiceHandle | null>(null);

  // 자동 진입은 없다 — 화면을 보는 사람이 먼저 페이지를 훑고, 필요할 때 헤더의
  // 마이크 버튼으로 음성 모드에 들어간다. (예전에는 ?voice=1로 바로 진입했다.)

  const dongs = useData<DongCollection<DongProps>>(DATA.dongs);
  const eta = useData<DispatchEtaData>(DATA.dispatchEta);
  const infra = useData<InfraPoint[]>(DATA.infraPoints);
  const shopData = useData<AccessActions>(DATA.accessActions);
  const hFacilities = useData<HaeundaeFacilities>(DATA.haeundaeFacilities);

  const dataPending = dongs.data === null || eta.data === null;

  // Fetch the road route whenever both ends are pinned.
  useEffect(() => {
    if (!origin || !dest) {
      setRoute(null);
      return;
    }
    let live = true;
    setRouting(true);
    fetchRoute(origin.coord, dest.coord)
      .then((r) => {
        if (live) setRoute(r);
      })
      .finally(() => {
        if (live) setRouting(false);
      });
    return () => {
      live = false;
    };
  }, [origin, dest]);

  // 목적지가 바뀌면 업종 필터를 푼다 — 이전 동네에만 있던 업종이 선택된 채로
  // 남으면 새 목적지에서 "0곳"만 보이고 원인이 화면에 드러나지 않는다.
  useEffect(() => {
    setCatFilter([]);
  }, [dest]);

  const wait: WaitEstimate | null = useMemo(() => {
    if (!origin || !dongs.data || !eta.data) return null;
    return lookupWait(origin.coord, hour, dongs.data, eta.data);
  }, [origin, hour, dongs.data, eta.data]);

  const adjustedWait = wait ? wait.minutes * CHAIR_WAIT[chair] : null;

  const facilities: NearestFacility[] = useMemo(() => {
    if (!dest || !infra.data) return [];
    return nearestByKind(dest.coord, infra.data, hFacilities.data?.points ?? []);
  }, [dest, infra.data, hFacilities.data]);

  // 휠체어 종류가 바뀌면 추천 목록 자체가 달라진다 (chair가 의존성에 들어간다).
  const shopGroups: GroupedShops = useMemo(() => {
    if (!dest || !shopData.data)
      return { fit: [], check: [], excluded: 0, cats: [] };
    return groupNearbyShops(dest.coord, shopData.data.shops, chair, catFilter);
  }, [dest, shopData.data, chair, catFilter]);

  // 지도에는 두 칸에 실제로 보이는 곳만 찍는다.
  const shops: NearbyShop[] = useMemo(
    () => [...shopGroups.fit, ...shopGroups.check],
    [shopGroups],
  );

  // ── 음성 안내 ──────────────────────────────────────────────────────────
  //
  // 화면에 흩어져 있는 답(대기시간 카드 · 시설 목록 · 식당 두 칸)을 한 문장으로 합친다.
  // 눈으로 보는 사람은 세 카드를 동시에 훑지만, 귀로 듣는 사람에게는 순서가 있는 한
  // 문장이어야 한다 — 그래서 낭독용 문장을 따로 만든다. 이 문장은 TTS의 대본이면서
  // 동시에 aria-live 영역에 그대로 렌더되는 텍스트다(같은 내용, 두 경로).

  const answer = useMemo(
    () =>
      composeAnswer({
        origin,
        dest,
        hour,
        chair,
        wait,
        adjusted: adjustedWait,
        facilities,
        groups: shopGroups,
        waitPending: dataPending,
        facilityPending: infra.data === null,
      }),
    [
      origin,
      dest,
      hour,
      chair,
      wait,
      adjustedWait,
      facilities,
      shopGroups,
      dataPending,
      infra.data,
    ],
  );

  /** 이미 낭독한 문장. 같은 답을 두 번 읽지 않게 막는다. */
  const spokenRef = useRef("");

  useEffect(() => {
    // 소리는 음성 모드에서만 낸다 — 눈으로 보는 사람이 페이지를 열었다고 해서
    // 스피커로 30초 낭독이 시작되면 안 된다.
    if (!voiceMode || !voiceOn || !answer.complete) return;
    // 음성 모드에서는 세 입력이 다 찰 때까지 기다린다. 도착지를 말한 순간 답이 완성되므로
    // 그대로 두면 30초 낭독이 시작됐다가 탑승 시각을 말하는 순간 끊기고 다시 시작한다.
    if (voiceMode && voiceStep < 3) return;
    if (answer.text === spokenRef.current) return;
    // 지연을 두는 이유는 두 가지다. 하나는 연속 입력을 삼키기 위해서고(답이 두 번
    // 바뀌는 동안 30초 낭독을 시작했다 끊는 것이 가장 비싼 낭비다), 다른 하나는 직전에
    // 나간 확정 복창("탑승 시각, 10시")이 끝날 시간을 주기 위해서다 — 겹치면 speak()가
    // 복창을 잘라버린다.
    const t = window.setTimeout(() => {
      spokenRef.current = answer.text;
      speak(answer.text);
    }, 1800);
    return () => window.clearTimeout(t);
  }, [answer, voiceOn, voiceMode, voiceStep]);

  // 토글을 끄는 순간 말을 멈춘다 — 다음 답까지 기다리면 토글이 고장난 것처럼 느껴진다.
  useEffect(() => {
    if (!voiceOn) stopSpeaking();
  }, [voiceOn]);

  // 페이지를 떠날 때 남은 발화를 끊는다. speechSynthesis는 문서와 수명을 공유하지
  // 않아서, 그냥 두면 대시보드로 돌아간 뒤에도 계속 말한다.
  useEffect(() => stopSpeaking, []);

  const replay = () => {
    spokenRef.current = answer.text;
    speak(answer.text);
  };

  /** 필드가 내보내는 짧은 문장을 소리로 흘린다 (안내 · 확정 복창 · 오류).
   *
   *  done을 받으면 다 말한 뒤에 부른다 — "말씀하세요"를 말하는 동안 마이크가 열려
   *  있으면 자기 TTS를 되받아 오인식하기 때문이다. 음성 안내가 꺼져 있어도 done은
   *  반드시 불러야 한다. 안 그러면 토글을 끈 순간 마이크가 영영 안 열린다. */
  const announce = (text: string, done?: () => void) => {
    if (voiceMode && voiceOn) speak(text, { onEnd: done });
    else done?.();
  };

  // ── 음성 모드 조작 ──────────────────────────────────────────────────────

  /** 단계 s(0=출발지 1=도착지 2=탑승 시각)의 음성 입력을 시작한다. */
  const startStep = (s: number) => {
    [originVoice, destVoice, hourVoice][Math.min(Math.max(s, 0), 2)].current?.start();
  };

  /** 짧게 탭 — 다음 단계. 세 개가 다 차 있으면 결과를 다시 읽는다. */
  const tapAdvance = () => {
    if (voiceStep >= 3) {
      replay();
      return;
    }
    startStep(voiceStep);
  };

  /** 길게 누르기 — 출발지부터 처음부터 다시 받는다. 눈 없이 구별할 수 있는 두 번째이자
   *  마지막 제스처이고, 새 경로를 다시 묻는 유일한 통로다. 값을 미리 지우지 않는 것은
   *  의도다: 인식이 성공하면 그대로 덮어쓰이고, 실패하면 원래 값이 남아 무대에서 빈
   *  화면이 되지 않는다. */
  const tapRestart = () => {
    setVoiceStep(0);
    // "처음부터 다시 시작합니다"가 끝난 뒤에 마이크가 열려야 한다 — 겹치면 자기 TTS를
    // 되받아 오인식하고, startStep이 내보내는 "출발지, 말씀하세요"도 잘린다.
    announce("처음부터 다시 시작합니다.", () => startStep(0));
  };

  /** 음성으로 값이 확정되면 단계가 하나 오른다. 슬라이더나 목록 클릭으로 바꾼 경우에는
   *  올리지 않는다 — 눈으로 조작하는 사람은 이 단계 카운터를 쓰지 않는다. */
  //
  //  확정 복창에 "다음에 무엇을 하라"를 붙이는 것이 여기 있는 이유다. 화면을 못 보는
  //  사람에게 "출발지, 센텀삼익아파트"만 들려주고 끝내면 흐름이 거기서 멈춘다 —
  //  다음이 무엇이고 무엇을 눌러야 하는지는 단계를 아는 이쪽만 말할 수 있다.
  const pickOrigin = (p: KakaoPlace, source: "voice" | "manual") => {
    setOrigin(p);
    if (source !== "voice") return;
    setVoiceStep((s) => (s === 0 ? 1 : s));
    announce(`출발지, ${p.name}. 도착지 입력을 위해 터치해 주세요.`);
  };
  const pickDest = (p: KakaoPlace, source: "voice" | "manual") => {
    setDest(p);
    if (source !== "voice") return;
    setVoiceStep((s) => (s === 1 ? 2 : s));
    announce(`도착지, ${p.name}. 탑승 시각 입력을 위해 터치해 주세요.`);
  };
  const pickHour = (h: number, source: "voice" | "slider") => {
    setHour(h);
    if (source === "voice") setVoiceStep((s) => (s === 2 ? 3 : s));
  };

  // ── map ────────────────────────────────────────────────────────────────

  /** 출발·도착이 찍혔을 때 카메라가 잡을 화면. spec과 반드시 분리해야 한다 —
   *  MapCanvas는 flyTo 객체의 IDENTITY가 바뀌면 다시 날아가므로, zoom을 의존성으로
   *  가진 spec 안에서 만들면 사용자가 확대하는 순간 새 flyTo가 생겨 카메라를 원래
   *  자리로 되돌려버린다 (= 확대할수록 밀려남). origin/dest에만 반응해야 한다. */
  const flyTo = useMemo(() => {
    if (origin && dest) {
      const mid: [number, number] = [
        (origin.coord[0] + dest.coord[0]) / 2,
        (origin.coord[1] + dest.coord[1]) / 2,
      ];
      const spanKm = Math.max(
        Math.abs(origin.coord[0] - dest.coord[0]) * 90,
        Math.abs(origin.coord[1] - dest.coord[1]) * 111,
      );
      const z = spanKm > 20 ? 10.2 : spanKm > 10 ? 11.2 : spanKm > 4 ? 12.2 : 13.2;
      return { longitude: mid[0], latitude: mid[1], zoom: z };
    }
    const only = dest ?? origin;
    return only ? { longitude: only.coord[0], latitude: only.coord[1], zoom: 13.5 } : null;
  }, [origin, dest]);

  const spec = useMemo(() => {
    const layers = [];

    if (route) {
      layers.push(
        new PathLayer<{ path: [number, number][] }>({
          id: "booking-route",
          data: [{ path: route.path }],
          getPath: (d) => d.path,
          getColor: route.source === "road" ? [34, 211, 238, 230] : [139, 150, 171, 200],
          getWidth: 6,
          widthMinPixels: 3,
          widthMaxPixels: 10,
          capRounded: true,
          jointRounded: true,
          pickable: false,
        }),
      );
    }

    // 마커는 실제 좌표에 그대로 찍는다 — 겹치는 건 감안한다. 어느 것을 집었는지는
    // 호버 시 커지는 효과와 툴팁이 알려준다.
    if (facilities.length > 0) {
      // mask:false → 텍스처 RGB를 그대로 쓴다 = 컬러 이모지. true면 알파만 쓰고
      // getColor로 칠해버려서 단색 실루엣이 된다.
      layers.push(
        new IconLayer<NearestFacility>({
          id: "booking-facilities",
          data: facilities,
          getPosition: (d) => d.coord,
          getIcon: (d) => ({
            id: d.kind,
            url: emojiMarkerUrl(FACILITY_EMOJI[d.kind]),
            width: MARKER_PX,
            height: MARKER_PX,
            mask: false,
          }),
          getSize: (d) =>
            hoverKey === `f-${d.kind}` ? MARKER_SIZE * MARKER_HOVER_SCALE : MARKER_SIZE,
          updateTriggers: { getSize: [hoverKey] },
          transitions: { getSize: 120 },
          sizeUnits: "pixels",
          pickable: true,
          // 자기 레이어가 잡고 있던 호버만 해제한다 — 겹친 마커 사이를 지날 때
          // 시설 레이어의 "빠져나감"이 식당 레이어의 "들어옴"을 덮어쓰면 안 된다.
          onHover: ({ object }) =>
            setHoverKey((prev) =>
              object ? `f-${object.kind}` : prev?.startsWith("f-") ? null : prev,
            ),
        }),
      );
    }

    if (shops.length > 0) {
      layers.push(
        new IconLayer<NearbyShop>({
          id: "booking-shops",
          data: shops,
          getPosition: (d) => [d.shop.lng, d.shop.lat],
          getIcon: () => ({
            id: "shop",
            url: emojiMarkerUrl(SHOP_EMOJI),
            width: MARKER_PX,
            height: MARKER_PX,
            mask: false,
          }),
          getSize: (d) =>
            hoverKey === shopKey(d) ? MARKER_SIZE * MARKER_HOVER_SCALE : MARKER_SIZE,
          updateTriggers: { getSize: [hoverKey] },
          transitions: { getSize: 120 },
          sizeUnits: "pixels",
          pickable: true,
          onHover: ({ object }) =>
            setHoverKey((prev) =>
              object ? shopKey(object) : prev?.startsWith("s-") ? null : prev,
            ),
        }),
      );
    }

    const ends: { coord: [number, number]; hex: string; label: string }[] = [];
    if (origin) ends.push({ coord: origin.coord, hex: ORIGIN_HEX, label: `출발 · ${origin.name}` });
    if (dest) ends.push({ coord: dest.coord, hex: DEST_HEX, label: `도착 · ${dest.name}` });
    if (ends.length > 0) {
      layers.push(
        new ScatterplotLayer<(typeof ends)[number]>({
          id: "booking-ends",
          data: ends,
          getPosition: (d) => d.coord,
          getFillColor: (d) => hexToRgb(d.hex),
          getRadius: 10,
          radiusUnits: "pixels",
          stroked: true,
          getLineColor: [226, 232, 240, 255],
          lineWidthMinPixels: 2,
          pickable: true,
        }),
      );
    }

    return {
      layers,
      flyTo,
      getTooltip: ({ object }: { object?: unknown }) => {
        const o = object;
        if (!o) return null;
        if (isFacility(o)) {
          return tooltipHtml(
            `<b>${escapeHtml(o.name)}</b><br/>${o.label} · ${formatDistance(o.distanceM)}`,
          );
        }
        if (isShop(o)) {
          return tooltipHtml(
            `<b>${escapeHtml(o.shop.name)}</b><br/>${escapeHtml(o.shop.cat)} · ${formatDistance(o.distanceM)}<br/>막히는 지점: ${escapeHtml(o.status.barrier)}`,
          );
        }
        if (isEnd(o)) return tooltipHtml(`<b>${escapeHtml(o.label)}</b>`);
        return null;
      },
    };
  }, [route, facilities, shops, origin, dest, flyTo, hoverKey]);

  return (
    <div className="min-h-screen bg-bg text-ink">
      {/* ── header ─────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-line bg-bg/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-4 py-3.5 lg:py-3">
          <div className="min-w-0">
            {/* 브랜드명은 대시보드·발표 자료와 같은 것을 쓴다 — 이 페이지만 '배차 예약'이면
                심사위원에게는 별개 서비스로 읽힌다. 기능 설명은 아래 줄로 내린다. */}
            <h1 className="truncate text-[17px] font-semibold lg:text-[15px]">
              어디든 두가자
            </h1>
            <p className="truncate text-[12px] text-dim lg:text-[11px]">
              배차 예약 · 예상 대기시간 · 목적지 무장애 시설
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* 모드 진입용. 나가기는 탭 면 위(z-50)의 전용 버튼이 맡는다 — 헤더는 z-30이라
                음성 모드에서는 탭 면(z-40)에 덮여 눌리지 않는다. 무대에서 '대시보드'가
                실수로 눌려 페이지를 떠나는 사고를 막는 것도 같은 이유다. */}
            <button
              type="button"
              onClick={() => {
                setVoiceMode(true);
                setVoiceStep(0);
                // 선택 UI를 감추는 이상 값도 고정해야 한다 — 화면에서 안 보이는
                // 조건이 결과를 바꾸면 낭독과 화면이 어긋난다.
                setChair("none");
                stopSpeaking();
              }}
              aria-pressed={voiceMode}
              aria-label="음성 모드"
              className={`flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] transition-colors lg:min-h-0 lg:px-2.5 lg:py-1.5 lg:text-[11px] ${
                voiceMode
                  ? "border-accent bg-accent/15 text-ink"
                  : "border-line text-dim hover:border-accent hover:text-ink"
              }`}
            >
              {/* 마이크 표시는 항상 둔다 — 이 버튼이 음성 진입점이라는 것을 아이콘이
                  들고 있어야 한다. 이모지는 기기·폰트마다 그림이 달라서 SVG로 그린다.
                  좁은 폭에서는 글자만 접는다(접근 가능한 이름은 aria-label이 든다). */}
              <MicIcon />
              <span className="hidden sm:inline">음성 안내</span>
            </button>
            <a
              href="/"
              className="shrink-0 rounded-lg border border-line px-3 py-2 text-[12px] text-dim transition-colors hover:border-accent hover:text-ink lg:px-2.5 lg:py-1.5 lg:text-[11px]"
            >
              대시보드
            </a>
          </div>
        </div>
      </header>

      {voiceMode && (
        <VoiceTapLayer
          step={voiceStep}
          onAdvance={tapAdvance}
          onRestart={tapRestart}
          onExit={() => {
            setVoiceMode(false);
            setVoiceStep(0);
            stopSpeaking();
          }}
        />
      )}

      {/* ONE map instance only.
          deck.gl Layer objects cannot be handed to two overlays — rendering the
          map twice (a mobile copy + a desktop copy hidden with CSS) still mounts
          both and trips `assert(!this.internalState)` ("finalized layer cannot be
          reused"). So this is a single grid whose MAP CHILD MOVES: on phones it
          sits third in flow (right under the wait card), and from lg: it jumps to
          a sticky second column spanning all four rows. */}
      {/* main 랜드마크 — 스크린리더가 헤더를 건너뛰고 본문으로 바로 갈 수 있어야
          하고, 페이지 내용이 랜드마크 밖에 남아 있으면 자동 검사도 걸린다. */}
      {/* 폰에서는 하단 탭(56px + 홈 인디케이터)이 위에 떠 있으므로 그만큼 더 비운다. */}
      <main className="mx-auto grid max-w-[1400px] grid-cols-1 gap-4 px-4 pb-[calc(5rem+env(safe-area-inset-bottom))] pt-4 md:pb-16 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:gap-5">
        <div className="space-y-4 lg:col-start-1 lg:row-start-1">
          <section
            aria-label="이동 정보 입력"
            className="space-y-4 rounded-2xl border border-line bg-panel/60 p-4 lg:space-y-3 lg:rounded-xl lg:p-3.5"
          >
            <PlaceInput
              label="출발지"
              placeholder="아파트·건물·주소로 검색"
              value={origin}
              onPick={pickOrigin}
              onClear={() => setOrigin(null)}
              accentHex={ORIGIN_HEX}
              voiceRef={originVoice}
              onAnnounce={announce}
              showMic={voiceMode}
            />
            <PlaceInput
              label="도착지"
              placeholder="목적지를 검색"
              value={dest}
              onPick={pickDest}
              onClear={() => setDest(null)}
              accentHex={DEST_HEX}
              voiceRef={destVoice}
              onAnnounce={announce}
              showMic={voiceMode}
            />

            <TimeField
              hour={hour}
              onHour={pickHour}
              voiceRef={hourVoice}
              onAnnounce={announce}
              showMic={voiceMode}
            />

            {/* 음성 모드에서는 휠체어 선택을 감춘다 — 음성 입력 3요소(출발·도착·시각)에
                들어가지 않는 조건이라 화면을 못 보는 사람에게는 조작할 수 없는 컨트롤이
                되고, 값은 '해당 없음'(보행 기준)으로 고정된다. */}
            {!voiceMode && (
            <div>
              <span
                id="booking-chair-label"
                className="mb-2 block text-[12px] text-dim lg:mb-1.5 lg:text-[11px]"
              >
                휠체어
              </span>
              {/* role="group" — 세 버튼은 하나의 선택지 묶음이다. 이름을 붙이지 않으면
                  스크린리더가 "수동 휠체어 버튼"만 읽고 무엇에 대한 선택인지 잃는다.
                  음성 입력 3요소에는 넣지 않았다(명세의 Non-Goal) — 기존 UI 그대로. */}
              <div
                role="group"
                aria-labelledby="booking-chair-label"
                className="flex gap-1.5"
              >
                {(Object.keys(CHAIR_LABEL) as Chair[]).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setChair(c)}
                    aria-pressed={chair === c}
                    className={`flex-1 rounded-xl border px-2 py-2.5 text-[12.5px] transition-colors lg:rounded-lg lg:py-1.5 lg:text-[11px] ${
                      chair === c
                        ? "border-accent bg-accent/10 text-ink"
                        : "border-line text-dim hover:border-dim"
                    }`}
                  >
                    {CHAIR_LABEL[c]}
                  </button>
                ))}
              </div>
            </div>
            )}
          </section>

          {/* 음성 안내 — 세 카드에 흩어진 답을 한 문장으로 합쳐 낭독하고, 같은 문장을
              라이브 영역으로도 내보낸다. 입력 바로 아래에 두는 이유: 귀로 쓰는
              사용자에게는 이것이 결과 화면 그 자체다. */}
          {voiceMode && (
            <AnswerCard
              answer={answer}
              voiceOn={voiceOn}
              onToggleVoice={() => setVoiceOn((v) => !v)}
              onReplay={replay}
            />
          )}

          {/* 예상 대기시간 — 요구사항상 가장 먼저 노출 */}
          <WaitCard
            wait={wait}
            adjusted={adjustedWait}
            chair={chair}
            hasOrigin={origin !== null}
            pending={dataPending}
            caveat={eta.data?.meta.caveats}
          />

        </div>

        {/* phones: third in flow · lg+: sticky right column */}
        <div className="lg:sticky lg:top-[84px] lg:col-start-2 lg:row-start-1 lg:row-span-3">
          <MapPanel
            spec={spec}
            route={route}
            routing={routing}
            cursor={hoverKey ? "pointer" : undefined}
            altText={mapAltText({ origin, dest, route, facilities, shops })}
          />
        </div>

        <div className="lg:col-start-1 lg:row-start-2">
          <FacilitySection
            dest={dest}
            facilities={facilities}
            pending={infra.data === null}
          />
        </div>

        {/* 식당은 두 칸(이용 가능 / 확인 필요)을 나란히 두므로 좌우 폭을 다 쓴다 —
            420px 사이드 칼럼 안에서 2단을 하면 한 칸이 200px 남짓으로 쪼그라든다. */}
        <div className="lg:col-span-2 lg:col-start-1 lg:row-start-3">
          <ShopSection
            dest={dest}
            groups={shopGroups}
            scope={shopData.data?.meta.scope}
            chair={chair}
            catFilter={catFilter}
            onToggleCat={(cat) =>
              setCatFilter((prev) =>
                prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
              )
            }
            onClearCats={() => setCatFilter([])}
          />
        </div>
      </main>

      {/* 폰에서만 뜨는 페이지 이동 탭 — 이 화면은 별도 라우트라 사이드바가 없다.
          음성 모드에서는 내린다: 탭 면(z-40)과 같은 층에 떠 있어서 화면 아래쪽을
          누르면 단계가 진행되는 대신 페이지를 떠나 버린다. 모드에서 나가는 길은
          z-50의 '음성인식 끄기' 하나로 충분하다. */}
      {!voiceMode && <BottomTabBar activeHref="/booking" floating />}
    </div>
  );
}

function VoiceTapLayer({
  step,
  onAdvance,
  onRestart,
  onExit,
}: {
  /** 음성으로 채운 입력 개수 0..3 */
  step: number;
  onAdvance: () => void;
  /** 길게 누르기 — 출발지부터 처음부터 다시 받는다. */
  onRestart: () => void;
  onExit: () => void;
}) {
  const LABELS = ["출발지", "도착지", "탑승 시각"];
  const timerRef = useRef<number | null>(null);
  const longRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const onDown = () => {
    longRef.current = false;
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      longRef.current = true;
      onRestart();
    }, 600);
  };

  const onUp = () => {
    clearTimer();
    if (!longRef.current) onAdvance();
  };

  useEffect(() => clearTimer, []);

  const done = step >= 3;
  const label = done
    ? "화면을 누르면 결과를 다시 듣습니다. 길게 누르면 탑승 시각을 다시 입력합니다."
    : `화면을 누르면 ${LABELS[step]}를 음성으로 입력합니다. 길게 누르면 이전 단계를 다시 입력합니다.`;

  return (
    <>
      <button
        type="button"
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerCancel={clearTimer}
        onPointerLeave={clearTimer}
        // 안드로이드에서 길게 누르면 컨텍스트 메뉴와 텍스트 선택이 뜬다 — 둘 다 막는다.
        onContextMenu={(e) => e.preventDefault()}
        aria-label={label}
        className="fixed inset-0 z-40 select-none bg-transparent"
      />

      {/* 단계 표시. pointer-events-none이라 탭은 아래 면으로 그대로 통과한다. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 z-40 flex items-center gap-3 border-b border-accent/40 bg-bg/95 px-4 py-3 backdrop-blur"
      >
        <MicIcon className="h-7 w-7 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold">
            {done ? "완료 — 짧게 누르면 다시 듣기" : "화면을 누르고 말하세요"}
          </p>
          <p className="tnum truncate text-[12px] text-accent">
            {done ? "3 / 3" : `${step + 1} / 3 · ${LABELS[step]}`} · 길게 누르면 처음부터
            다시
          </p>
        </div>
      </div>

      {/* 탭 면에서 제외되는 유일한 영역. 모드에 갇히지 않게 하는 비상구다. */}
      <button
        type="button"
        onClick={onExit}
        aria-label="음성인식 끄기"
        className="fixed right-2 top-2 z-50 flex h-14 items-center justify-center rounded-full border border-line bg-panel px-4 text-[13px] font-semibold text-dim transition-colors hover:border-accent hover:text-ink"
      >
        음성인식 끄기
      </button>
    </>
  );
}

// ── panels ─────────────────────────────────────────────────────────────────

function MapPanel({
  spec,
  route,
  routing,
  cursor,
  altText,
}: {
  spec: Parameters<typeof MapCanvas>[0]["spec"];
  route: RouteResult | null;
  routing: boolean;
  cursor?: string;
  /** 지도가 시각적으로 전달하는 내용의 텍스트 대안 */
  altText: string;
}) {
  const shellRef = useRef<HTMLDivElement>(null);

  // 지도 캔버스를 접근성 트리와 포커스 순서에서 동시에 뺀다.
  //
  // 둘을 같이 해야 한다. aria-hidden만 걸고 tabindex를 남기면 "숨긴 요소에 포커스가
  // 갈 수 있다"는 위반이 되고(axe aria-hidden-focus), 실제로도 키보드 사용자가
  // 아무것도 읽히지 않는 캔버스에 빠진다. 반대로 tabindex만 빼면 스크린리더가
  // maplibre의 `aria-label="Map"` 캔버스를 여전히 "지도"라고만 읽어, 그 안의 어떤
  // 정보도 전달하지 못한 채 지나간다.
  //
  // 캔버스는 우리가 만드는 요소가 아니라 maplibre/deck.gl이 나중에 붙이므로
  // MutationObserver로 다시 붙는 경우(베이스맵 오프라인 폴백 전환)까지 덮는다.
  // 지도가 주는 정보는 아래 altText와 대기시간·시설 목록이 글로 대신 준다.
  useEffect(() => {
    const root = shellRef.current;
    if (!root) return;
    const hide = () => {
      root.querySelectorAll("canvas").forEach((c) => {
        c.setAttribute("aria-hidden", "true");
        c.setAttribute("tabindex", "-1");
      });
    };
    hide();
    const mo = new MutationObserver(hide);
    mo.observe(root, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);

  return (
    // 폰에서는 좌우 여백을 넘겨 화면 끝까지 붙인다 — 카드 안에 갇힌 작은 지도는
    // 앱이 아니라 축소된 데스크톱 화면처럼 읽힌다. lg:부터는 다시 카드로 돌아간다.
    <section
      aria-label="지도"
      className="-mx-4 overflow-hidden border-y border-line lg:mx-0 lg:rounded-xl lg:border"
    >
      {/* 48dvh on a phone keeps the form reachable — dvh(아닌 vh)여야 주소창이
          접힐 때 지도가 화면 밖으로 밀리지 않는다. 큰 화면은 sticky 칼럼 높이. */}
      <div
        ref={shellRef}
        className="relative h-[48dvh] min-h-[260px] lg:h-[calc(100vh-190px)] lg:min-h-[420px]"
      >
        <MapCanvas spec={spec} cursor={cursor} />
      </div>
      {/* 지도의 텍스트 대안. 화면에는 필요 없다 — 그 정보는 이미 지도 그림이
          전달하고 있다. 화면에 또 쓰면 같은 말이 두 번 보인다. */}
      <p className="sr-only">{altText}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line bg-panel/60 px-4 py-2.5 text-[12px] text-dim lg:px-3 lg:py-2 lg:text-[11px]">
        {routing ? (
          <span>경로 계산 중…</span>
        ) : route ? (
          <>
            <span className="tnum text-ink">{formatDistance(route.distanceM)}</span>
            {route.durationS !== null && (
              <span className="tnum">차량 {formatDuration(route.durationS)}</span>
            )}
            <span>
              {route.source === "road" ? "실제 도로 경로 (카카오모빌리티)" : route.note}
            </span>
          </>
        ) : (
          <span>출발지·도착지를 선택하면 경로가 표시됩니다</span>
        )}
      </div>
    </section>
  );
}

/** 탑승 시각 — 음성 입력 3요소 중 하나(출발지·도착지·탑승 시각).
 *
 *  슬라이더와 마이크가 같은 상태를 만진다. 슬라이더는 눈으로 쓰는 사람에게 24칸을
 *  한눈에 보여주고, 마이크는 "오후 세 시"를 그대로 받는다 — 스크린리더로 슬라이더를
 *  24번 밀어 15시를 맞추는 것은 1분 예산 안에서 불가능하다. */
function TimeField({
  hour,
  onHour,
  voiceRef,
  onAnnounce,
  showMic = false,
}: {
  hour: number;
  /** source는 음성 모드의 단계 카운터를 위한 것이다 — 슬라이더로 바꾼 경우에는 단계가
   *  올라가면 안 된다. 눈으로 조작하는 사람은 그 카운터를 쓰지 않는다. */
  onHour: (h: number, source: "voice" | "slider") => void;
  voiceRef?: React.RefObject<VoiceHandle | null>;
  onAnnounce?: (text: string, done?: () => void) => void;
  /** 마이크는 음성 모드(`?voice=1`)에서만 노출한다. */
  showMic?: boolean;
}) {
  const id = useId();
  const statusId = `${id}-status`;
  const [picked, setPicked] = useState("");

  const voice = useVoiceInput({
    onResult: (transcript) => {
      const h = parseSpokenHour(transcript, new Date().getHours());
      if (h === null) {
        // 들린 말을 그대로 되돌려준다 — 무엇이 오인식됐는지 모르면 다시 말할 수 없다.
        setPicked(`"${transcript}"에서 시각을 알아듣지 못했습니다. "오후 세 시"처럼 말씀해 주세요.`);
        return;
      }
      onHour(h, "voice");
      // 확정 복창은 짧게. "…로 정했습니다. 다르면 변경 버튼을" 같은 안내는 무대에서
      // 발표자에겐 이미 아는 말이고 심사위원에겐 정보가 아니다.
      setPicked(`탑승 시각, ${h}시`);
    },
    prompt: "탑승 시각, 말씀하세요.",
    announce: onAnnounce,
  });

  // 음성 모드의 화면 탭이 이 필드의 인식을 시작하기 위한 손잡이.
  useEffect(() => {
    if (!voiceRef) return;
    voiceRef.current = { start: voice.toggle };
    return () => {
      voiceRef.current = null;
    };
  });

  // 확정 복창과 오류만 소리로. 안내는 startWithPrompt가 이미 말했다.
  const announcedRef = useRef("");
  useEffect(() => {
    // 마이크를 다시 열면 같은 오류를 또 말할 수 있어야 한다 — 3초 무음이 연속으로
    // 나는 것은 흔하고, 두 번째에 침묵하면 고장으로 보인다.
    if (voice.listening) announcedRef.current = "";
  }, [voice.listening]);
  useEffect(() => {
    const line = voice.error ? voice.error : picked;
    if (!line || line === announcedRef.current) return;
    announcedRef.current = line;
    onAnnounce?.(line);
  }, [voice.error, picked, onAnnounce]);

  // 음성 모드를 끄면 열려 있던 마이크를 닫고, 음성에서 나온 문구도 함께 지운다 —
  // 마이크가 사라진 화면에 "새로고침 후 다시 말씀해 주세요"만 남으면 지시가 붕 뜬다.
  const toggleRef = useRef(voice.toggle);
  toggleRef.current = voice.toggle;
  useEffect(() => {
    if (showMic) return;
    if (voice.listening) toggleRef.current();
    setPicked("");
  }, [showMic, voice.listening]);

  const status = !showMic
    ? ""
    : voice.listening
      ? "탑승 시각, 말씀하세요."
      : (voice.error ?? picked);

  return (
    <div>
      <label
        htmlFor={id}
        className="mb-2 flex items-baseline justify-between text-[12px] text-dim lg:mb-1.5 lg:text-[11px]"
      >
        <span>탑승 시각</span>
        <span className="tnum text-[15px] font-medium text-ink lg:text-[11px] lg:font-normal">
          {hour}시
        </span>
      </label>
      <div className="flex items-center gap-3">
        <input
          id={id}
          type="range"
          min={0}
          max={23}
          value={hour}
          onChange={(e) => onHour(Number(e.target.value), "slider")}
          // 슬라이더는 값을 "15"로만 읽는다 — 단위를 붙여야 시각임이 전달된다.
          aria-valuetext={`${hour}시`}
          aria-describedby={statusId}
          // 폰에서 높이를 옆 마이크 버튼(44px)에 맞춘다.
          className="h-11 w-full lg:h-auto"
        />
        {showMic && (
          <MicButton
            label="탑승 시각 음성으로 입력"
            listening={voice.listening}
            supported={voice.supported}
            onToggle={voice.toggle}
          />
        )}
      </div>
      <p
        id={statusId}
        role="status"
        aria-live="polite"
        className="mt-1.5 min-h-[16px] text-[12.5px] leading-snug text-accent empty:mt-0 empty:min-h-0 lg:mt-1 lg:min-h-[14px] lg:text-[11px]"
      >
        {status}
      </p>
    </div>
  );
}

/** 음성 안내 카드 — 낭독 대본을 화면에도 그대로 보여준다.
 *
 *  이 카드가 결과 화면 그 자체인 사용자가 있다(귀로만 쓰는 경우). 그래서 문장은
 *  숨기지 않고 aria-live 영역에 그대로 렌더한다 — TTS를 끈 스크린리더 사용자에게는
 *  이쪽이 유일한 통로이고, 발표자에게는 지금 무엇이 낭독됐는지 눈으로 확인할 화면이다. */
function AnswerCard({
  answer,
  voiceOn,
  onToggleVoice,
  onReplay,
}: {
  answer: SpokenAnswer;
  voiceOn: boolean;
  onToggleVoice: () => void;
  onReplay: () => void;
}) {
  // 지원 여부는 마운트 후에만 알 수 있다 — 서버 렌더와 어긋나지 않게 effect에서 잡는다.
  const [canSpeak, setCanSpeak] = useState(false);
  useEffect(() => setCanSpeak(speechOutputSupported()), []);

  return (
    <section
      aria-label="음성 안내"
      className="rounded-2xl border border-accent/40 bg-accent/5 p-4 lg:rounded-xl lg:p-3.5"
    >
      <div className="mb-2.5 flex items-center justify-between gap-2 lg:mb-2">
        <h2 className="text-[12px] font-medium tracking-wide text-accent lg:text-[11px] lg:tracking-normal">
          음성 안내
        </h2>
        {canSpeak && (
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={onReplay}
              disabled={!answer.complete}
              className="rounded-lg border border-line px-3 py-2 text-[12px] text-dim transition-colors hover:border-accent hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 lg:px-2 lg:py-1 lg:text-[10.5px]"
            >
              다시 듣기
            </button>
            {/* 스크린리더가 켜져 있는지 브라우저가 알 수 없어 이중 낭독을 코드로는
                막을 수 없다 — 이 토글이 유일한 해법이다. 기본값은 켬. */}
            <button
              type="button"
              onClick={onToggleVoice}
              aria-pressed={voiceOn}
              aria-label={`음성 안내 ${voiceOn ? "끄기" : "켜기"}`}
              className={`rounded-lg border px-3 py-2 text-[12px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent lg:px-2 lg:py-1 lg:text-[10.5px] ${
                voiceOn
                  ? "border-accent bg-accent/15 text-ink"
                  : "border-line text-dim hover:border-dim hover:text-ink"
              }`}
            >
              <span aria-hidden>{voiceOn ? "🔊" : "🔇"}</span> {voiceOn ? "켬" : "끔"}
            </button>
          </div>
        )}
      </div>

      <p
        role="status"
        aria-live="polite"
        className="text-[14.5px] leading-relaxed text-ink lg:text-[12.5px]"
      >
        {answer.text}
      </p>

      {!canSpeak && (
        <p className="mt-2 text-[11.5px] leading-relaxed text-dim lg:text-[10px]">
          · 이 브라우저는 음성 낭독을 지원하지 않습니다 — 위 문장이 화면과 스크린리더로만
          전달됩니다.
        </p>
      )}
    </section>
  );
}

function WaitCard({
  wait,
  adjusted,
  chair,
  hasOrigin,
  pending,
  caveat,
}: {
  wait: WaitEstimate | null;
  adjusted: number | null;
  chair: Chair;
  hasOrigin: boolean;
  pending: boolean;
  caveat?: string;
}) {
  return (
    <section className="rounded-2xl border border-line bg-panel/60 p-4 lg:rounded-xl lg:p-3.5">
      <h2 className="mb-2.5 text-[12px] font-medium tracking-wide text-dim lg:mb-2 lg:text-[11px] lg:font-normal lg:tracking-normal">
        예상 대기시간
      </h2>

      {!hasOrigin ? (
        <p className="text-[14px] leading-relaxed text-dim lg:text-[13px]">
          출발지를 선택하면 예상 대기시간을 계산합니다.
        </p>
      ) : pending ? (
        <p className="text-[14px] text-dim lg:text-[13px]">데이터 준비 중…</p>
      ) : !wait || adjusted === null ? (
        <p className="text-[14px] leading-relaxed text-dim lg:text-[13px]">
          이 지역의 배차 기록이 없어 대기시간을 추정할 수 없습니다.
        </p>
      ) : (
        <>
          {/* 폰에서는 CI를 분 옆에 붙이지 않고 아래 줄로 내린다 — 360px 폭에서
              "47 분 95% CI 31–68분"은 반드시 줄바꿈되고, 그러면 큰 숫자와
              각주가 뒤엉킨다. */}
          <div className="flex items-baseline gap-2">
            <span className="tnum text-[44px] font-semibold leading-none text-accent lg:text-[34px]">
              {Math.round(adjusted)}
            </span>
            <span className="text-[15px] text-dim lg:text-[13px]">분</span>
            {wait.ci && (
              <span className="tnum ml-1 hidden text-[11px] text-dim lg:inline">
                95% CI {Math.round(wait.ci[0] * (adjusted / wait.minutes))}–
                {Math.round(wait.ci[1] * (adjusted / wait.minutes))}분
              </span>
            )}
          </div>
          {wait.ci && (
            <p className="tnum mt-1.5 text-[12px] text-dim lg:hidden">
              95% CI {Math.round(wait.ci[0] * (adjusted / wait.minutes))}–
              {Math.round(wait.ci[1] * (adjusted / wait.minutes))}분
            </p>
          )}

          <p className="mt-2.5 text-[12.5px] text-dim lg:mt-2 lg:text-[11px]">
            {wait.gu} {wait.dongName} · {wait.hour}시 접수 기준
            {chair !== "none" && ` · ${CHAIR_LABEL[chair]} 보정`}
          </p>

          <dl className="mt-3 grid grid-cols-2 gap-2 text-[12px] lg:mt-2.5 lg:text-[11px]">
            <div className="rounded-xl border border-line px-3 py-2.5 lg:rounded-lg lg:px-2 lg:py-1.5">
              <dt className="text-dim">미배차 가능성</dt>
              <dd className="tnum mt-1 text-[15px] text-ink lg:mt-0.5 lg:text-[11px]">
                {(wait.unassignedShare * 100).toFixed(1)}%
              </dd>
            </div>
            <div className="rounded-xl border border-line px-3 py-2.5 lg:rounded-lg lg:px-2 lg:py-1.5">
              <dt className="text-dim">표본</dt>
              <dd className="tnum mt-1 text-[15px] text-ink lg:mt-0.5 lg:text-[11px]">
                {wait.n.toLocaleString()}건
              </dd>
            </div>
          </dl>

          <ul className="mt-3 space-y-1 text-[11.5px] leading-relaxed text-dim lg:mt-2.5 lg:space-y-0.5 lg:text-[10px]">
            {wait.hourFallback && (
              <li>· 해당 시간대 표본이 없어 이 동의 중위 시간대 값을 사용했습니다.</li>
            )}
            {!wait.exactDong && (
              <li>· 출발지가 행정동 경계 밖이라 가장 가까운 동 기준으로 계산했습니다.</li>
            )}
            {caveat && <li>· {caveat}</li>}
          </ul>
        </>
      )}
    </section>
  );
}

function FacilitySection({
  dest,
  facilities,
  pending,
}: {
  dest: KakaoPlace | null;
  facilities: NearestFacility[];
  pending: boolean;
}) {
  const found = new Set(facilities.map((f) => f.kind));
  const missing = FACILITY_ORDER.filter((k) => !found.has(k));

  return (
    <section className="rounded-2xl border border-line bg-panel/60 p-4 lg:rounded-xl lg:p-3.5">
      <h2 className="mb-2.5 text-[12px] font-medium tracking-wide text-dim lg:mb-2 lg:text-[11px] lg:font-normal lg:tracking-normal">
        도착지 주변 시설 <span className="opacity-70">· 카테고리별 최근접</span>
      </h2>

      {!dest ? (
        <p className="text-[14px] leading-relaxed text-dim lg:text-[13px]">
          도착지를 선택하면 주변 시설을 표시합니다.
        </p>
      ) : pending ? (
        <p className="text-[14px] text-dim lg:text-[13px]">데이터 준비 중…</p>
      ) : facilities.length === 0 ? (
        <p className="text-[14px] leading-relaxed text-dim lg:text-[13px]">
          반경 5km 안에 등록된 시설이 없습니다.
        </p>
      ) : (
        <>
          <ul className="space-y-2 lg:space-y-1.5">
            {facilities.map((f) => (
              <li
                key={f.kind}
                className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5 lg:gap-2.5 lg:rounded-lg lg:px-2.5 lg:py-2"
              >
                {/* 지도 마커와 같은 글리프 — 목록의 색 점은 지도 위 점과 짝을
                    맞추려고 있었으므로, 지도가 이모지가 되면 여기도 따라간다. */}
                <span
                  className="w-[22px] shrink-0 text-center text-[18px] leading-none lg:w-[18px] lg:text-[14px]"
                  aria-hidden
                >
                  {FACILITY_EMOJI[f.kind]}
                </span>
                <div className="min-w-0 flex-1">
                  <MapNameLink
                    coord={f.coord}
                    name={f.name}
                    className="text-[14px] lg:text-[12.5px]"
                  />
                  <p className="truncate text-[12px] text-dim lg:text-[10.5px]">
                    {f.label}
                    {f.detail ? ` · ${f.detail}` : ""}
                  </p>
                </div>
                <span className="tnum shrink-0 text-[13px] text-dim lg:text-[11.5px]">
                  {formatDistance(f.distanceM)}
                </span>
              </li>
            ))}
          </ul>

          {/* Two honesty captions. An empty slot outside 해운대구 is a data gap, not
              an accessibility finding — and so is a suspiciously FAR one: the
              nearest 화장실 to 부산시청 is not really 4 km away, it is simply absent
              from the 해운대구 실사. Both must be said out loud. */}
          {missing.length > 0 && (
            <p className="mt-2.5 text-[11.5px] leading-relaxed text-dim lg:mt-2 lg:text-[10px]">
              · {missing.map((k) => FACILITY_LABEL[k]).join(" · ")}: 반경 5km 내 없음
            </p>
          )}
          {facilities.some((f) => HAEUNDAE_ONLY_KINDS.includes(f.kind)) && (
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-dim lg:mt-1 lg:text-[10px]">
              ·{" "}
              {HAEUNDAE_ONLY_KINDS.map((k) => FACILITY_LABEL[k]).join(" · ")}은 해운대구
              실사 데이터 기준입니다 — 구 외 지역은 미집계라 실제보다 멀게 표시될 수
              있습니다.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function ShopSection({
  dest,
  groups,
  scope,
  chair,
  catFilter,
  onToggleCat,
  onClearCats,
}: {
  dest: KakaoPlace | null;
  groups: GroupedShops;
  scope?: string;
  chair: Chair;
  catFilter: string[];
  onToggleCat: (cat: string) => void;
  onClearCats: () => void;
}) {
  // 휠체어를 고르지 않아도 분류는 한다 — 축만 좁아진다. '해당 없음'은 보행 기준이라
  // 계단(1층 아님 + 엘리베이터 없음) 하나만 보고, 입구턱은 결격으로 세지 않는다.
  const walkOnly = chair === "none";
  const fitTitle = walkOnly ? "바로 진입 가능" : "이용 가능";
  const checkTitle = walkOnly ? "계단 확인 필요" : "확인 필요";
  const { fit, check, excluded, cats } = groups;
  const empty = fit.length === 0 && check.length === 0;
  // 반경 안에 표시 가능한 곳이 아예 없는 것과, 업종 필터 때문에 0곳이 된 것은
  // 완전히 다른 상황이다 — 후자는 필터를 풀면 되므로 그렇게 안내한다.
  const emptyByFilter = empty && catFilter.length > 0 && cats.length > 0;

  return (
    <section className="rounded-2xl border border-line bg-panel/60 p-4 lg:rounded-xl lg:p-3.5">
      <h2 className="mb-3 text-[12px] font-medium tracking-wide text-dim lg:mb-2.5 lg:text-[11px] lg:font-normal lg:tracking-normal">
        도착지 주변 무장애 식당{" "}
        <span className="opacity-70">
          {walkOnly ? "· 보행 기준" : `· ${CHAIR_LABEL[chair]} 기준`}
        </span>
      </h2>

      {/* 업종 선택 — 목록보다 위에 둔다. 카드가 최대 10장이라 아래에 두면 필터를
          보려고 결과 전체를 지나쳐야 하고, 화면에 없는 것처럼 보인다.
          칩 목록은 업종 필터와 무관하게 반경 기준 전체이므로, 필터를 걸어도 해제할
          칩이 사라지지 않는다. */}
      {dest && cats.length > 0 && (
        <div className="mb-4 lg:mb-3">
          <div className="mb-2 flex items-center justify-between gap-2 lg:mb-1.5">
            <span className="text-[12px] text-dim lg:text-[11px]">
              업종
              {catFilter.length > 0 && (
                <span className="ml-1 text-accent">{catFilter.length}개 선택</span>
              )}
            </span>
            {catFilter.length > 0 && (
              <button
                type="button"
                onClick={onClearCats}
                aria-label="업종 필터 전체 해제"
                className="text-[12px] text-accent transition-opacity hover:opacity-80 lg:text-[10.5px]"
              >
                전체 보기
              </button>
            )}
          </div>
          {/* 폰: 줄바꿈 대신 가로 스크롤 한 줄. 업종이 20개쯤 되면 wrap은 화면
              네 줄을 먹고, 그만큼 결과 목록이 아래로 밀려 스크롤 없이는 식당이
              한 곳도 안 보인다. lg:부터는 폭이 남으니 다시 wrap. */}
          <ul
            aria-label="업종 필터"
            className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 no-scrollbar lg:mx-0 lg:flex-wrap lg:gap-1 lg:overflow-visible lg:px-0 lg:pb-0"
          >
            {cats.map(({ cat, count }) => {
              const on = catFilter.includes(cat);
              return (
                <li key={cat} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => onToggleCat(cat)}
                    aria-pressed={on}
                    // aria-label을 붙이지 않는다. 화면의 "한식 3"이 그대로 이름이 된다 —
                    // 이 칩은 무대에서 소리로 나갈 것이 아니고, 눈으로 보는 사용자에게는
                    // 이미 충분하다. 소리에 실리지 않을 것에 낭독용 이름을 다는 것은
                    // 접근성이 아니라 잡음이다.
                    className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-[12.5px] transition-colors lg:px-2 lg:py-0.5 lg:text-[11px] ${
                      on
                        ? "border-accent bg-accent/15 text-ink"
                        : "border-line text-dim hover:border-dim hover:text-ink"
                    }`}
                  >
                    {cat} <span className="tnum opacity-60">{count}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {!dest ? (
        <p className="text-[14px] leading-relaxed text-dim lg:text-[13px]">
          도착지를 선택하면 식당을 표시합니다.
        </p>
      ) : emptyByFilter ? (
        <p className="text-[14px] leading-relaxed text-dim lg:text-[13px]">
          선택한 업종에 해당하는 곳이 없습니다. 위에서 업종을 바꾸거나 전체로
          돌리세요.
        </p>
      ) : empty ? (
        <p className="text-[14px] leading-relaxed text-dim lg:text-[13px]">
          {excluded > 0
            ? `반경 1.5km 안 ${excluded}곳이 모두 ${CHAIR_LABEL[chair]}로 진입 불가입니다.`
            : `이 주변은 무장애가게 실사 데이터가 아직 없습니다${scope ? ` (현재 표본: ${scope})` : ""}.`}
        </p>
      ) : (
        <>
          {/* 두 칸은 위아래로 쌓고 lg: 이상에서만 좌우로 나뉜다. sm:(640px)로 두면
              폰 가로 모드에서 한 칸이 180px로 쪼그라들어 상호명이 두 글자마다
              줄바꿈된다 — 세로에서 피한 문제가 가로에서 그대로 재현됐다. */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-3">
            <ShopColumn
              title={fitTitle}
              fitState="fit"
              shops={fit}
              emptyText="실사로 확인된 곳이 이 반경에 없습니다."
            />
            <ShopColumn
              title={checkTitle}
              fitState="check"
              shops={check}
              emptyText="확인이 필요한 곳은 없습니다."
            />
          </div>

          {excluded > 0 && (
            <p className="mt-3 text-[11.5px] leading-relaxed text-dim lg:mt-2.5 lg:text-[10px]">
              · {CHAIR_LABEL[chair]}로 진입 불가한 {excluded}곳은 양쪽 모두에서
              제외했습니다 (입구턱 있음 · 화장실턱 있음 · 2층 이상인데 엘리베이터 없음).
            </p>
          )}
        </>
      )}

    </section>
  );
}

function ShopColumn({
  title,
  fitState,
  shops,
  emptyText,
}: {
  title: string;
  fitState: Fit;
  shops: NearbyShop[];
  emptyText: string;
}) {
  const hex = FIT_HEX[fitState];
  return (
    <div>
      <h3
        className="mb-2 flex items-center gap-1.5 text-[13px] font-medium lg:mb-1.5 lg:text-[11px]"
        style={{ color: hex }}
      >
        <span
          className="h-2 w-2 rounded-full lg:h-1.5 lg:w-1.5"
          style={{ background: hex }}
          aria-hidden
        />
        {title}
        <span className="tnum opacity-70">{shops.length}곳</span>
      </h3>
      {shops.length === 0 ? (
        <p className="text-[12.5px] leading-relaxed text-dim lg:text-[11px]">{emptyText}</p>
      ) : (
        <ul className="space-y-2.5 lg:space-y-2">
          {shops.map((s) => (
            <ShopCard key={`${s.shop.name}-${s.shop.lng}`} entry={s} showFit />
          ))}
        </ul>
      )}
    </div>
  );
}

function ShopCard({ entry, showFit }: { entry: NearbyShop; showFit: boolean }) {
  const { shop, status, distanceM, fit } = entry;
  return (
    <li
      className="space-y-2 rounded-xl border px-3 py-2.5 lg:space-y-1.5 lg:rounded-lg lg:px-2.5 lg:py-2"
      style={{
        // 배지 색만으로는 스크롤 중에 놓치므로 테두리로도 등급을 구분한다.
        borderColor: showFit ? `${FIT_HEX[fit.fit]}55` : undefined,
      }}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <MapNameLink
            coord={[shop.lng, shop.lat]}
            name={shop.name}
            className="text-[14.5px] font-medium lg:text-[13px]"
          />
          <p className="truncate text-[12px] text-dim lg:text-[10.5px]">
            {shop.cat} · {formatDistance(distanceM)}
            {shop.dong ? ` · ${shop.dong}` : ""}
          </p>
        </div>
        {!showFit && <VerdictBadge status={status} />}
      </div>

      {/* 확인 필요 사유 (판정에 반영된 것) */}
      {showFit &&
        fit.steps
          .filter((s) => s.state !== "fit")
          .map((s) => (
            <p
              key={s.label}
              className="text-[12px] leading-relaxed lg:text-[10.5px]"
              style={{ color: FIT_HEX[s.state] }}
            >
              {s.label}: {s.note}
            </p>
          ))}

      {/* 판정에 반영되지 않은 미조사 사실 — '이용 가능' 카드에도 붙는다 */}
      {showFit &&
        fit.notes.map((n) => (
          <p key={n} className="text-[12px] leading-relaxed text-dim lg:text-[10.5px]">
            {n}
          </p>
        ))}

      <AccessTagList fields={shop.fields} />
      {!showFit && <ChainLine status={status} />}
      {!showFit && <FixLine status={status} />}
    </li>
  );
}

function FitBadge({ fit }: { fit: Fit }) {
  const hex = FIT_HEX[fit];
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ background: `${hex}22`, color: hex, border: `1px solid ${hex}55` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: hex }} aria-hidden />
      {FIT_LABEL[fit]}
    </span>
  );
}

/** 시설·가게 이름 자체가 카카오맵 링크다 — 별도 "지도" 버튼을 두면 같은 곳으로 가는
 *  링크가 한 행에 두 개 생기고, 스크린리더는 그걸 두 번 읽는다. 이름은 truncate하되
 *  ↗ 표시는 항상 보이도록 span을 분리했다. */
function MapNameLink({
  coord,
  name,
  className,
}: {
  coord: [number, number];
  name: string;
  className?: string;
}) {
  return (
    <a
      href={kakaoMapUrl(coord, name)}
      target="_blank"
      rel="noopener noreferrer"
      title={`카카오맵에서 ${name} 보기`}
      className={`flex min-w-0 items-baseline gap-1 transition-colors hover:text-accent hover:underline focus-visible:text-accent ${className ?? ""}`}
    >
      <span className="truncate">{name}</span>
      <span aria-hidden className="shrink-0 text-[9px] opacity-55">
        ↗
      </span>
    </a>
  );
}

// ── 낭독 문장 ──────────────────────────────────────────────────────────────

interface SpokenAnswer {
  /** TTS 대본이면서 aria-live 영역에 그대로 렌더되는 문장 (같은 내용, 두 경로) */
  text: string;
  /** 출발지·도착지가 모두 찼는가. false면 낭독을 시작하지 않는다 — 입력 도중의
   *  "도착지를 말씀해 주세요"를 소리로 반복하면 다음 발화를 밟아 인식이 깨진다. */
  complete: boolean;
}

/** 귀로 들을 순서대로 답을 합친다.
 *
 *  눈으로 보는 사람은 세 카드(대기시간·시설·식당)를 동시에 훑지만, 귀로 듣는
 *  사람에게는 순서가 있는 한 문장이어야 한다. 순서는 명세 AC-4 그대로
 *  예상 대기시간 → 도착지 주변 접근시설이다 — 대기시간이 갈지 말지를 정하고,
 *  시설은 가서 무엇을 할 수 있는지를 정한다.
 *
 *  숫자 표기가 화면과 다르다: spokenDistance()는 "320미터"를 쓴다. 화면용
 *  formatDistance()의 "320m"을 그대로 읽히면 엔진에 따라 "엠"으로 발음된다. */
function composeAnswer({
  origin,
  dest,
  hour,
  chair,
  wait,
  adjusted,
  facilities,
  groups,
  waitPending,
  facilityPending,
}: {
  origin: KakaoPlace | null;
  dest: KakaoPlace | null;
  hour: number;
  chair: Chair;
  wait: WaitEstimate | null;
  adjusted: number | null;
  facilities: NearestFacility[];
  groups: GroupedShops;
  waitPending: boolean;
  facilityPending: boolean;
}): SpokenAnswer {
  // 아직 다 안 찼을 때는 "무엇이 비었는지"만 말한다. 남은 항목을 알려주지 않으면
  // 화면을 보지 않는 사용자는 흐름이 멈춘 이유를 알 수 없다.
  if (!origin && !dest) {
    return {
      text: "출발지와 도착지를 음성으로 말씀해 주세요. 마이크 버튼을 누르고 말하면 됩니다.",
      complete: false,
    };
  }
  if (!dest) {
    return {
      text: `출발지는 ${origin!.name}입니다. 이제 도착지를 말씀해 주세요.`,
      complete: false,
    };
  }
  if (!origin) {
    return {
      text: `도착지는 ${dest.name}입니다. 이제 출발지를 말씀해 주세요.`,
      complete: false,
    };
  }

  const parts: string[] = [
    `${origin.name}에서 ${dest.name}${particleRo(dest.name)} ${hour}시 출발입니다.`,
  ];

  // 1) 예상 대기시간
  if (waitPending) {
    parts.push("예상 대기시간은 데이터를 준비하는 중입니다.");
  } else if (!wait || adjusted === null) {
    parts.push("이 지역은 배차 기록이 없어 예상 대기시간을 추정할 수 없습니다.");
  } else {
    parts.push(`예상 대기시간은 약 ${Math.round(adjusted)}분입니다.`);
    parts.push(
      `${wait.dongName} ${wait.hour}시 접수 기준이고, 미배차 가능성은 ${Math.round(
        wait.unassignedShare * 100,
      )}퍼센트입니다.`,
    );
    if (chair !== "none") {
      parts.push(`${CHAIR_LABEL[chair]} 리프트 고정 시간을 반영한 값입니다.`);
    }
  }

  // 2) 도착지 주변 접근시설 — 귀로는 세 곳까지가 한 번에 기억되는 한계다.
  if (facilityPending) {
    parts.push("주변 시설은 데이터를 준비하는 중입니다.");
  } else if (facilities.length === 0) {
    parts.push("도착지 반경 5킬로미터 안에 등록된 접근시설이 없습니다.");
  } else {
    const top = facilities.slice(0, 3);
    parts.push(
      `도착지 주변 접근시설은 ${top
        .map((f) => `${f.label} ${f.name} ${spokenDistance(f.distanceM)}`)
        .join(", ")}입니다.`,
    );
    if (facilities.length > top.length) {
      parts.push(`다른 종류 시설 ${facilities.length - top.length}곳이 더 있습니다.`);
    }
  }

  // 3) 무장애가게 — 개수를 먼저, 가장 가까운 한 곳만 이름으로.
  //
  //    chair === "none"이면 판정 표현을 쓰지 않는다. wheelchairFit이 그 경우 검사를
  //    통째로 건너뛰고 전부 "fit"으로 돌려주기 때문이다(lib/wheelchair.ts:73). 그대로
  //    "이용 가능 5곳, 확인 필요 0곳"이라고 말하면 하지도 않은 검사를 발견인 것처럼
  //    제시하게 된다 — 같은 파일이 스스로 경계하는 함정("미조사"를 "안전"으로 승격)을
  //    낭독이 저지르는 꼴이다. 그래서 개수라는 사실만 말한다.
  const { fit, check } = groups;
  const nearby = [...fit, ...check];
  if (nearby.length === 0) {
    parts.push("주변에 실사된 무장애가게는 없습니다.");
  } else {
    parts.push(
      chair === "none"
        ? `도착지 주변 무장애가게는 ${nearby.length}곳입니다.`
        : `무장애가게는 이용 가능 ${fit.length}곳, 확인 필요 ${check.length}곳입니다.`,
    );
    // fit[0]은 '이용 가능' 중 최근접일 뿐이다 — 두 칸을 합쳐서 가장 가까운 곳을 고른다.
    const nearest = nearby.reduce((a, b) => (b.distanceM < a.distanceM ? b : a));
    parts.push(
      `가장 가까운 곳은 ${nearest.shop.name}, ${spokenDistance(nearest.distanceM)}입니다.`,
    );
  }

  // 4) 다음에 무엇을 할 수 있는지. 화면을 못 보는 사람에게 낭독이 끝난 정적은
  //    "끝났다"가 아니라 "고장났다"로 읽힌다 — 두 제스처를 마지막에 다시 알려준다.
  parts.push(
    "다시 들으시려면 화면을 짧게 터치해 주세요. 새로운 경로로 입력하시려면 화면을 길게 눌러 주세요.",
  );

  return { text: parts.join(" "), complete: true };
}

/** 지도의 텍스트 대안 — 그림이 전달하는 것을 문장으로.
 *
 *  캔버스는 aria-hidden이므로(MapPanel) 지도가 보여주는 사실은 여기서만 전달된다.
 *  마커 위치를 좌표로 읊는 것은 쓸모가 없다 — 무엇이 몇 개 있고 어디까지 이어지는지가
 *  지도를 봐서 얻는 정보다. */
function mapAltText({
  origin,
  dest,
  route,
  facilities,
  shops,
}: {
  origin: KakaoPlace | null;
  dest: KakaoPlace | null;
  route: RouteResult | null;
  facilities: NearestFacility[];
  shops: NearbyShop[];
}): string {
  if (!origin && !dest) {
    return "지도. 출발지와 도착지를 선택하면 경로와 도착지 주변 시설이 표시됩니다.";
  }

  const parts: string[] = ["지도."];
  if (origin && dest) {
    parts.push(`${origin.name}에서 ${dest.name}까지의 경로가 표시돼 있습니다.`);
    if (route) {
      parts.push(
        route.source === "road"
          ? `도로 거리 ${spokenDistance(route.distanceM)}.`
          : `직선 거리 ${spokenDistance(route.distanceM)}. 도로 경로를 가져오지 못해 직선으로 표시했습니다.`,
      );
    }
  } else {
    parts.push(`${(dest ?? origin)!.name}이 표시돼 있습니다.`);
  }

  if (facilities.length > 0) {
    parts.push(`도착지 주변 접근시설 ${facilities.length}곳이 종류별로 찍혀 있습니다.`);
  }
  if (shops.length > 0) {
    parts.push(`무장애 식당 ${shops.length}곳이 함께 표시됩니다.`);
  }
  parts.push("같은 내용이 아래 목록에 글로 정리돼 있습니다.");
  return parts.join(" ");
}

// ── helpers ────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
    235,
  ];
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}

/** 식당 마커의 호버 키. 같은 상호가 여러 지점일 수 있어 좌표까지 넣는다. */
function shopKey(s: NearbyShop): string {
  return `s-${s.shop.name}-${s.shop.lng}`;
}

function isFacility(o: unknown): o is NearestFacility {
  return typeof o === "object" && o !== null && "kind" in o && "distanceM" in o;
}

function isShop(o: unknown): o is NearbyShop {
  return typeof o === "object" && o !== null && "shop" in o && "status" in o;
}

function isEnd(o: unknown): o is { label: string } {
  return typeof o === "object" && o !== null && "label" in o && !("kind" in o);
}
