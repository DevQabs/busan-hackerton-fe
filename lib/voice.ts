"use client";

// Web Speech API 얇은 래퍼 — /booking의 음성 입력과 결과 낭독.
//
// 왜 이 파일이 있는가: 전맹 사용자가 스크린리더로 한글을 타이핑하면 글자당 수 초가
// 걸린다. "해운대구청" 한 단어에 30초가 넘어가므로 출발지·도착지·탑승 시각을
// 타이핑으로 받는 흐름은 1분 시연 안에 절대 완주하지 못한다. 그래서 입력은 음성으로,
// 결과는 앱이 직접 낭독하는 구조를 택했다.
//
// 브라우저 사실 관계 (설계 전제):
//   · SpeechRecognition  — Chrome(데스크톱/안드로이드)에서 동작. Firefox 미지원,
//     iOS Safari 신뢰 불가. 인식을 위해 오디오를 서버로 보내므로 네트워크에 의존하고
//     마이크 권한 프롬프트가 뜬다. 시연 기기를 Chrome으로 못 박았기에 분기 코드는 없다.
//   · SpeechSynthesis    — iOS 포함 광범위 지원.
//   · 스크린리더가 켜져 있는지는 웹에서 감지할 방법이 없다. 그래서 앱 TTS와
//     스크린리더 낭독이 겹치는 문제는 코드로 못 풀고 사용자 토글로만 해결한다.
//
// TypeScript의 lib.dom.d.ts에는 SpeechRecognitionResult/ResultList만 있고
// SpeechRecognition 생성자 선언이 없다 — 그래서 필요한 만큼만 직접 타이핑한다.

import { useCallback, useEffect, useRef, useState } from "react";

// ── SpeechRecognition ──────────────────────────────────────────────────────

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { results: SpeechRecognitionResultList }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** 이 브라우저에서 음성 입력이 가능한가. */
export function voiceInputSupported(): boolean {
  return recognitionCtor() !== null;
}

/** 인식 실패 사유를 사용자가 뭘 해야 하는지로 번역한다.
 *  null을 돌려주면 알리지 않는다 — 사용자가 직접 중지한 경우까지 오류로 읽으면
 *  스크린리더가 쓸데없이 말을 얹는다. */
function recognitionErrorText(code: string): string | null {
  switch (code) {
    case "aborted":
      return null;
    case "no-speech":
      return "소리가 들리지 않았습니다. 마이크 버튼을 다시 누르고 말씀해 주세요.";
    case "not-allowed":
    case "service-not-allowed":
      return "마이크 권한이 없습니다. 주소창의 자물쇠 아이콘에서 마이크를 허용해 주세요.";
    case "audio-capture":
      return "마이크를 찾을 수 없습니다.";
    case "network":
      return "네트워크 오류로 음성 인식에 실패했습니다.";
    default:
      return "음성 인식에 실패했습니다. 다시 시도해 주세요.";
  }
}

export interface VoiceInput {
  /** 이 브라우저가 음성 입력을 지원하는가 (마운트 후 확정) */
  supported: boolean;
  /** 지금 듣고 있는가 */
  listening: boolean;
  /** 사용자에게 알려야 할 오류. 없으면 null */
  error: string | null;
  /** 듣기 시작. 이미 듣고 있으면 중지한다 (같은 버튼으로 토글) */
  toggle: () => void;
}

/** 한 번에 한 마디를 받아 `onResult`로 넘기는 음성 입력.
 *
 *  continuous=false / interimResults=false — 확정된 한 문장만 필요하다. 중간 결과를
 *  흘리면 "해운" 같은 조각으로 카카오 검색이 먼저 나가고, 뒤늦게 온 확정 결과가
 *  다른 곳을 집는다. */
export function useVoiceInput({
  onResult,
  lang = "ko-KR",
}: {
  onResult: (transcript: string) => void;
  lang?: string;
}): VoiceInput {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<RecognitionLike | null>(null);
  // onResult는 렌더마다 새 함수일 수 있다 — 인식 객체를 다시 만들지 않도록 ref로 읽는다.
  const cbRef = useRef(onResult);
  cbRef.current = onResult;

  useEffect(() => {
    setSupported(voiceInputSupported());
    return () => {
      recRef.current?.abort();
      recRef.current = null;
    };
  }, []);

  const toggle = useCallback(() => {
    if (recRef.current) {
      recRef.current.abort();
      recRef.current = null;
      setListening(false);
      return;
    }

    const Ctor = recognitionCtor();
    if (!Ctor) {
      setError("이 브라우저는 음성 입력을 지원하지 않습니다. Chrome을 사용해 주세요.");
      return;
    }

    // 낭독 중에 마이크를 열면 스크린리더/TTS 소리를 그대로 되받아 오인식한다.
    stopSpeaking();
    // 첫 발화는 사용자 제스처 안에서 한 번 깨워둬야 나중에 effect에서 말할 수 있다.
    primeSpeech();

    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      setError(null);
      setListening(true);
    };
    rec.onresult = (e) => {
      const transcript = e.results[0]?.[0]?.transcript?.trim() ?? "";
      if (transcript) cbRef.current(transcript);
    };
    rec.onerror = (e) => {
      const text = recognitionErrorText(e.error);
      if (text) setError(text);
    };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
    };

    recRef.current = rec;
    try {
      rec.start();
    } catch {
      // 이미 시작된 인식기를 다시 start하면 던진다 — 상태만 정리한다.
      recRef.current = null;
      setListening(false);
    }
  }, [lang]);

  return { supported, listening, error, toggle };
}

// ── SpeechSynthesis ────────────────────────────────────────────────────────

export function speechOutputSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

let primed = false;

/** 사용자 제스처 안에서 한 번 호출해 발화 권한을 열어둔다.
 *  안드로이드 Chrome은 제스처 없는 첫 speak()를 무시하는 경우가 있어, 결과 낭독이
 *  effect에서 시작되는 이 페이지에서는 마이크 탭 시점에 미리 깨워야 한다. */
export function primeSpeech(): void {
  if (primed || !speechOutputSupported()) return;
  primed = true;
  try {
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    window.speechSynthesis.speak(u);
  } catch {
    /* 발화 준비는 실패해도 흐름을 막지 않는다 */
  }
}

function koreanVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang === "ko-KR") ??
    voices.find((v) => v.lang?.toLowerCase().startsWith("ko")) ??
    null
  );
}

/** 낭독. 앞선 발화는 취소한다 — 입력이 바뀌면 옛 답을 끝까지 읽을 이유가 없다.
 *  rate 기본값을 1보다 올린 것은 1분 시연 제약 때문이다. */
export function speak(text: string, rate = 1.15): void {
  if (!speechOutputSupported() || !text) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ko-KR";
  u.rate = rate;
  const v = koreanVoice();
  if (v) u.voice = v;
  synth.speak(u);
}

export function stopSpeaking(): void {
  if (!speechOutputSupported()) return;
  window.speechSynthesis.cancel();
}

// ── 한국어 시각 파싱 ────────────────────────────────────────────────────────

/** 고유어 수사 — 시각을 말할 때 쓰는 쪽 ("세 시"). */
const NATIVE_HOUR: Record<string, number> = {
  한: 1,
  두: 2,
  세: 3,
  네: 4,
  다섯: 5,
  여섯: 6,
  일곱: 7,
  여덟: 8,
  아홉: 9,
  열: 10,
  열한: 11,
  열두: 12,
};

/** 한자어 수사 — "십오 시"처럼 24시제로 말하는 경우. */
const SINO_HOUR: Record<string, number> = {
  영: 0,
  공: 0,
  일: 1,
  이: 2,
  삼: 3,
  사: 4,
  오: 5,
  육: 6,
  칠: 7,
  팔: 8,
  구: 9,
  십: 10,
  십일: 11,
  십이: 12,
  십삼: 13,
  십사: 14,
  십오: 15,
  십육: 16,
  십칠: 17,
  십팔: 18,
  십구: 19,
  이십: 20,
  이십일: 21,
  이십이: 22,
  이십삼: 23,
};

/** 말한 문장에서 탑승 시각(0–23)을 뽑는다. 못 알아들으면 null.
 *
 *  Chrome의 한국어 인식은 "오후 세 시"를 대개 그대로 한글로, "15시"는 숫자로
 *  돌려준다 — 두 경로를 모두 받는다. 분은 버린다: 대기시간 추정 격자가 시간 단위라
 *  30분을 반영할 곳이 없고, 없는 정밀도를 있는 척하는 편이 더 나쁘다. */
export function parseSpokenHour(text: string, nowHour: number): number | null {
  const t = text.replace(/\s+/g, "");
  if (!t) return null;

  if (/지금|현재|당장|바로/.test(t)) return nowHour;
  if (/정오/.test(t)) return 12;
  if (/자정/.test(t)) return 0;

  const pm = /오후|저녁|밤/.test(t);
  const am = /오전|아침|새벽/.test(t);

  let hour: number | null = null;

  const digit = t.match(/(\d{1,2})\s*시/) ?? t.match(/(\d{1,2})/);
  if (digit) {
    hour = Number(digit[1]);
  } else {
    // '시' 바로 앞의 한글을 최장 3글자까지 잡고, 뒤에서부터 수사로 맞춰본다.
    // "오후세시" → "오후세" → "후세"(실패) → "세"(3).
    const word = t.match(/([가-힣]{1,3})시/);
    if (word) {
      const w = word[1];
      for (const key of [w, w.slice(-2), w.slice(-1)]) {
        if (key in NATIVE_HOUR) {
          hour = NATIVE_HOUR[key];
          break;
        }
        if (key in SINO_HOUR) {
          hour = SINO_HOUR[key];
          break;
        }
      }
    }
  }

  if (hour === null || !Number.isFinite(hour)) return null;
  if (pm && hour < 12) hour += 12;
  if (am && hour === 12) hour = 0;
  return hour >= 0 && hour <= 23 ? hour : null;
}

// ── 낭독용 숫자 표기 ────────────────────────────────────────────────────────

/** 비율을 귀로 듣기 좋게. "%"를 그대로 넘기면 영문자로 읽는 엔진이 있다.
 *  0.254 → "25퍼센트". 소수점은 버린다 — 낭독에서 0.4퍼센트 차이는 정보가 아니다. */
export function spokenPercent(share: number): string {
  return `${Math.round(share * 100)}퍼센트`;
}

/** 조사 "(으)로" 선택 — 받침이 없거나 ㄹ 받침이면 "로", 그밖에는 "으로".
 *  장소 이름을 문장에 끼워 낭독하므로("센텀시티로" / "부산역으로") 필요하다. */
export function particleRo(word: string): string {
  const last = word.trim().slice(-1);
  const code = last.charCodeAt(0);
  if (Number.isNaN(code) || code < 0xac00 || code > 0xd7a3) return "로";
  const jong = (code - 0xac00) % 28;
  return jong === 0 || jong === 8 ? "로" : "으로";
}

/** 거리를 귀로 듣기 좋은 문장으로. "320미터" / "1.4킬로미터".
 *  화면용 formatDistance(lib/proximity.ts)는 "320m"처럼 기호를 쓰는데, TTS가
 *  "m"을 영어 알파벳으로 읽어버리는 엔진이 있어 낭독은 따로 만든다. */
export function spokenDistance(m: number): string {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)}미터`;
  const km = m / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)}킬로미터`;
}
