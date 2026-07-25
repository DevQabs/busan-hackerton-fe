"use client";

// GPU 방어선 — 모바일 GPU에서 셰이더 프로그램 하나가 실패해도 화면 전체가
// 망가지지 않게 한다.
//
// 왜 필요한가 (실제 증상):
// luma.gl의 Shader는 `debugShaders` 기본값이 "errors"다. 이 값이 걸린 채로
// 셰이더가 실패하면 `Shader._displayShaderLog()`가 **셰이더 원문과 드라이버
// 번역본을 담은 흰색 <div>를 document.body에 직접 append** 한다
// (@luma.gl/core/adapter/resources/shader.js).
//
// "프로덕션 빌드니까 괜찮다"가 성립하지 않는다: WEBGLShader._compile()은
// device.props.debug가 false면 컴파일 상태 확인을 건너뛰고 'pending'으로
// 남겨두는데, 나중에 프로그램 링크가 실패하면
// webgl-shared-render-pipeline._reportLinkStatus()가 'pending' 셰이더에 대해
// **debug 플래그와 무관하게** debugShader()를 호출한다. 그래서 안드로이드처럼
// 프로그램 링크가 깨지는 기기에서는 배포본에서도 지도 위에 GLSL 소스가 깔린다.
//
// 그 흰 패널은 fixed·z-index 9999·가로 폭 무제한이라 페이지에 가로 스크롤까지
// 만들고, 스스로 사라지지 않는다(닫기 버튼을 눌러야 없어진다).

import { useEffect, useState } from "react";
import type { DeckProps } from "@deck.gl/core";

/** deck.gl이 만드는 luma.gl 디바이스 설정.
 *  `debugShaders: "never"`가 위의 DOM 주입 경로를 원천 차단한다. */
export const DECK_DEVICE_PROPS: DeckProps["deviceProps"] = {
  debugShaders: "never",
  // NODE_ENV 추론(globalThis.process)이 번들러마다 달라서 명시로 못박는다.
  // debug: true면 luma가 Khronos WebGL 디버그 래퍼를 CDN에서 받아 모든 GL
  // 호출을 감싼다 — 폰에서는 그것만으로도 프레임이 무너진다.
  debug: false,
  debugWebGL: false,
};

// ── GPU 실패 감지 ────────────────────────────────────────────────────────────
// 셰이더/링크 실패는 luma 내부 async 함수에서 발생해 deck의 onError로 오지
// 않고 unhandledrejection으로 새는 경우가 있다. 두 경로를 모두 받는다.

// 셰이더 파이프라인이 깨졌을 때만 폴백으로 내려간다. "program" 같은 흔한
// 단어를 넣으면 무관한 에러가 히트맵을 조용히 떨어뜨리므로 좁게 잡는다.
// 컨텍스트 유실은 여기 넣지 않는다 — 지도 전체가 복구 대상이지 히트맵만의
// 문제가 아니고, deck이 스스로 복구를 시도한다.
const SHADER_ERROR = /shader|glsl|link error|validation error|renderpipeline/i;

let gpuFailed = false;
const subscribers = new Set<() => void>();

/** deck의 onError 자리에 들어간다. deck 기본 핸들러는 모든 에러를 콘솔에
 *  남기므로(deck.js: `onError: error => log.error(...)`), 그 역할을 반드시
 *  유지해야 한다 — 안 그러면 컨텍스트 유실 같은 신호가 통째로 사라진다.
 *  로깅은 언제나 하고, 셰이더 실패일 때만 추가로 폴백을 켠다. */
export function reportGpuFailure(error: unknown): void {
  console.error("[deck]", error);
  noteShaderFailure(error);
}

/** 셰이더 실패면 폴백을 켠다. 로그는 남기지 않는다 — 브라우저가 이미 잡히지
 *  않은 예외를 콘솔에 찍으므로, 창 리스너 경로에서 또 찍으면 중복이 된다. */
function noteShaderFailure(error: unknown): void {
  const message =
    error instanceof Error ? `${error.message} ${error.name}` : String(error);
  if (gpuFailed || !SHADER_ERROR.test(message)) return;
  gpuFailed = true;
  console.warn("[gpu] 고급 레이어를 대체 렌더링으로 전환합니다.");
  subscribers.forEach((notify) => notify());
}

let listening = false;
function listenOnce(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  // 셰이더 링크 실패는 luma 내부 async 함수에서 나 deck의 onError로 오지 않고
  // 그대로 새는 경우가 있다. 그 경로만 줍는다 — 삼키지는 않는다.
  window.addEventListener("unhandledrejection", (event) =>
    noteShaderFailure(event.reason),
  );
  window.addEventListener("error", (event) => noteShaderFailure(event.error));
}

// ── 사전 탐지 ────────────────────────────────────────────────────────────────

let heatmapProbe: boolean | null = null;

/** HeatmapLayer는 float 렌더타깃 + float 블렌딩 위에서 KDE를 굽는다.
 *  둘 중 하나라도 없는 기기에서는 애초에 태우지 않는다. 결과는 캐시한다
 *  (WebGL 컨텍스트 슬롯은 유한하므로 프로브 컨텍스트는 즉시 반납한다). */
function probeHeatmapSupport(): boolean {
  if (heatmapProbe !== null) return heatmapProbe;
  if (typeof document === "undefined") return true;
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) {
      heatmapProbe = false;
      return heatmapProbe;
    }
    heatmapProbe = Boolean(
      gl.getExtension("EXT_color_buffer_float") &&
        gl.getExtension("EXT_float_blend"),
    );
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    heatmapProbe = false;
  }
  return heatmapProbe;
}

/** 이 기기에서 히트맵(부동소수 KDE)을 그려도 되는가.
 *  false면 씬은 산점도 기반 밀도 표현으로 내려간다. */
export function useHeatmapSupported(): boolean {
  // 첫 렌더는 항상 false — 지원 여부를 모른 채 무거운 레이어를 태워 놓고
  // 다음 프레임에 걷어내는 편보다, 안 태우고 시작해 올리는 편이 안전하다.
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    listenOnce();
    if (!gpuFailed && probeHeatmapSupport()) setSupported(true);
    const notify = () => setSupported(false);
    subscribers.add(notify);
    return () => {
      subscribers.delete(notify);
    };
  }, []);

  return supported;
}
