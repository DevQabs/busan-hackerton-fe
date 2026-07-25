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

import { useEffect, useRef, useState } from "react";

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

/** 마이크를 열어두고 이 시간 동안 아무 말도 안 들리면 포기하고 다시 청한다.
 *
 *  인식기 자체의 `no-speech`에 맡길 수 없다. 발화 시점을 언제로 볼지가 플랫폼마다
 *  다르고, 안드로이드에서는 마이크가 열린 채 한참을 기다리다 아예 오지 않기도 한다.
 *  무대에서 "지금 듣고 있는 건가"를 궁금해하는 침묵은 3초면 이미 길다. */
const SILENCE_MS = 3000;

/** 무음을 몇 번까지 "다시 말해 주세요"로 넘길지. 이 횟수째에 포기한다. */
const SILENCE_LIMIT = 3;

/** 1·2회 무음 — 아직 실패가 아니다. 다시 청하고 마이크를 다시 연다. */
const SILENCE_RETRY = "잘 못 들었습니다. 다시 말씀해 주세요.";

/** 3회째 무음 — 여기서 멈춘다.
 *
 *  "오류"라는 말은 쓰지 않는다. 화면을 보지 않는 사람에게 오류는 정보가 아니라
 *  막다른 길이다. 지금 무엇을 하면 되는지만 말한다. */
const SILENCE_GIVEUP = "소리가 들리지 않았습니다. 새로고침 후 다시 말씀해 주세요.";

/** 인식 실패 사유를 사용자가 뭘 해야 하는지로 번역한다.
 *  null을 돌려주면 알리지 않는다 — 사용자가 직접 중지한 경우까지 오류로 읽으면
 *  스크린리더가 쓸데없이 말을 얹는다. */
function recognitionErrorText(code: string): string | null {
  switch (code) {
    case "aborted":
      return null;
    case "no-speech":
      // 무음은 여기서 다루지 않는다 — 재시도 횟수를 세는 쪽(handleSilence)이 맡는다.
      return null;
    case "not-allowed":
    case "service-not-allowed":
      return "마이크 권한이 없습니다. 주소창의 자물쇠 아이콘에서 마이크를 허용해 주세요.";
    case "audio-capture":
      return "마이크를 찾을 수 없습니다.";
    case "network":
      return "인식 서버에 연결하지 못했습니다. 새로고침 후 다시 말씀해 주세요.";
    default:
      return "음성을 인식하지 못했습니다. 새로고침 후 다시 말씀해 주세요.";
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
  prompt,
  announce,
}: {
  onResult: (transcript: string) => void;
  lang?: string;
  /** 마이크를 열기 직전에 말할 안내. 예: "출발지, 말씀하세요."
   *
   *  안내를 말하는 동안 마이크가 열려 있으면 마이크가 자기 TTS를 되받아 안내 문구를
   *  입력으로 인식한다. 그래서 안내가 끝난 뒤에 연다 — 이 순서를 훅이 보장한다. */
  prompt?: string;
  /** 문장을 소리로 내보낸다. done을 주면 다 말한 뒤에 부른다.
   *  낭독이 불가능한 기기에서도 done은 반드시 불려야 마이크가 열린다. */
  announce?: (text: string, done?: () => void) => void;
}): VoiceInput {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<RecognitionLike | null>(null);
  /** 무음 감시 타이머. 열려 있는 동안만 살아 있다. */
  const silenceRef = useRef<number | null>(null);
  /** 이번 시도에서 무음 처리를 이미 했는가. 네이티브 no-speech와 우리 타이머가
   *  동시에 터지는 경우를 한 번으로 접는다. */
  const handledRef = useRef(false);
  /** 사용자가 직접 시작한 뒤로 몇 번 무음이었나. 결과가 들어오면 0으로 돌아간다. */
  const attemptRef = useRef(0);

  // 렌더마다 새 함수/문자열일 수 있다 — 인식 콜백이 옛 값을 붙잡지 않게 ref로 읽는다.
  const cbRef = useRef(onResult);
  cbRef.current = onResult;
  const announceRef = useRef(announce);
  announceRef.current = announce;
  const promptRef = useRef(prompt);
  promptRef.current = prompt;
  /** 재시도에서 자기 자신을 다시 부르기 위한 손잡이 (순환 참조 회피). */
  const beginRef = useRef<() => void>(() => {});

  const clearSilence = () => {
    if (silenceRef.current !== null) {
      window.clearTimeout(silenceRef.current);
      silenceRef.current = null;
    }
  };

  useEffect(() => {
    setSupported(voiceInputSupported());
    return () => {
      clearSilence();
      recRef.current?.abort();
      recRef.current = null;
    };
  }, []);

  /** 마이크를 실제로 연다. 안내는 이미 끝난 상태라고 가정한다. */
  const begin = () => {
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

    /** 아무 말도 안 들린 채 이번 시도가 끝났다.
     *
     *  1·2회는 실패가 아니다 — 다시 청하고 마이크를 다시 연다. 무대에서 한 번 못
     *  알아들었다고 멈춰 서면 발표자는 무엇을 해야 할지 모른다. 대신 무한히 되열지는
     *  않는다: 3회째에는 멈추고, 무엇을 하면 되는지(새로고침)만 말한다. */
    const handleSilence = () => {
      if (handledRef.current) return;
      handledRef.current = true;
      clearSilence();
      attemptRef.current += 1;
      recRef.current?.abort();

      if (attemptRef.current >= SILENCE_LIMIT) {
        setError(SILENCE_GIVEUP);
        return;
      }
      const speakIt = announceRef.current;
      if (speakIt) speakIt(SILENCE_RETRY, () => beginRef.current());
      else beginRef.current();
    };

    rec.onstart = () => {
      setError(null);
      setListening(true);
      handledRef.current = false;
      clearSilence();
      silenceRef.current = window.setTimeout(handleSilence, SILENCE_MS);
    };
    rec.onresult = (e) => {
      clearSilence();
      handledRef.current = true;
      const transcript = e.results[0]?.[0]?.transcript?.trim() ?? "";
      if (transcript) {
        attemptRef.current = 0;
        cbRef.current(transcript);
      }
    };
    rec.onerror = (e) => {
      // no-speech는 우리 타이머보다 먼저 올 수도, 아예 안 올 수도 있다. 어느 쪽이든
      // 재시도 횟수를 세는 곳은 하나여야 한다.
      if (e.error === "no-speech") {
        handleSilence();
        return;
      }
      const text = recognitionErrorText(e.error);
      if (text) setError(text);
    };
    rec.onend = () => {
      clearSilence();
      // 재시도로 새 인식기가 이미 붙었을 수 있다 — 그때는 건드리지 않는다.
      if (recRef.current === rec) {
        recRef.current = null;
        setListening(false);
      }
    };

    recRef.current = rec;
    try {
      rec.start();
    } catch {
      // 이미 시작된 인식기를 다시 start하면 던진다 — 상태만 정리한다.
      recRef.current = null;
      setListening(false);
    }
  };
  beginRef.current = begin;

  const toggle = () => {
    if (recRef.current) {
      clearSilence();
      handledRef.current = true;
      recRef.current.abort();
      recRef.current = null;
      setListening(false);
      return;
    }
    // 사용자가 직접 시작한 순간부터 다시 센다.
    attemptRef.current = 0;
    const text = promptRef.current;
    const speakIt = announceRef.current;
    if (text && speakIt) speakIt(text, begin);
    else begin();
  };

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
    const synth = window.speechSynthesis;
    // 안드로이드에서는 합성기가 paused 상태로 남아 있는 경우가 있다 — 먼저 깨운다.
    synth.resume();
    // 목소리 목록은 비동기로 채워진다. 여기서 한 번 건드려두면 실제 낭독 시점에
    // 한국어 목소리를 고를 수 있다.
    synth.getVoices();
    // 공백 한 칸(" ")으로는 잠금이 풀리지 않는다 — 일부 안드로이드 빌드가 내용 없는
    // 발화를 그냥 버리기 때문이다. 실제 문장을 볼륨 0으로 흘려보내야 열린다.
    const u = new SpeechSynthesisUtterance("음성 안내를 준비합니다");
    u.lang = "ko-KR";
    u.volume = 0;
    synth.speak(u);
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
export function speak(
  text: string,
  { rate = 1.15, onEnd }: { rate?: number; onEnd?: () => void } = {},
): void {
  // onEnd는 "말한 뒤에 마이크를 연다"를 위한 것이다. 그래서 낭독이 불가능한 경우에도
  // 반드시 한 번은 불려야 한다 — 안 그러면 소리가 안 나는 기기에서 마이크가 영영
  // 안 열린다. 아래 done()이 그 보증이다.
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    onEnd?.();
  };

  if (!speechOutputSupported() || !text) {
    done();
    return;
  }
  const synth = window.speechSynthesis;

  const utter = () => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ko-KR";
    u.rate = rate;
    const v = koreanVoice();
    if (v) u.voice = v;
    u.onend = done;
    u.onerror = done;
    // 안드로이드에서 onend가 끝내 안 오는 경우가 있다. 글자 수로 상한을 잡아 풀어준다.
    if (onEnd) window.setTimeout(done, 1200 + text.length * 90);
    // 화면이 꺼졌다 켜지거나 탭이 백그라운드에 다녀오면 안드로이드 Chrome의 합성기가
    // paused 로 남는다. 그 상태에서 speak()하면 아무 일도 일어나지 않고 오류도 없다.
    synth.resume();
    synth.speak(u);
  };

  if (synth.speaking || synth.pending) {
    // cancel() 직후 같은 틱에서 speak()하면 안드로이드에서 새 발화까지 함께 삼켜진다.
    // 취소가 반영될 한 틱을 주고 나서 말한다 — 데스크톱에서는 체감되지 않는 지연이다.
    synth.cancel();
    window.setTimeout(utter, 80);
  } else {
    utter();
  }
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
