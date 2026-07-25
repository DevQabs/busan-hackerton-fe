"use client";

// 출발지/도착지 입력 — 카카오 로컬 검색(서버 프록시 경유) 자동완성 + 음성 입력.
// Debounced so typing an apartment name does not fire a request per keystroke.
//
// 음성 경로가 왜 붙었나: 스크린리더로 한글을 타이핑하면 글자당 수 초가 걸린다. 아래
// input은 2글자 이상에서만 검색하므로 "해운대구청"을 손으로 넣는 것만으로 1분 시연
// 예산이 날아간다. 그래서 마이크로 한 마디 말하면 → 검색 → 최상위 후보를 자동 채택
// 하고, 틀렸으면 '변경'으로 되돌린다. 되묻지 않는 이유는 하나뿐이다: 후보를 읽어주고
// 고르게 하면 왕복이 한 번 더 생겨 1분 안에 못 끝낸다.
//
// 목록에 listbox/option 롤을 씌우지 않은 것은 의도다. aria-activedescendant로
// 포커스를 위임하지 않는 한 role="option"은 규격 위반이 되고, 실제 버튼 목록이면
// Tab·화살표로 이미 다 닿는다. 대신 결과 개수를 라이브 영역으로 알린다.

import { useEffect, useId, useRef, useState } from "react";
import { searchPlaces, type KakaoPlace } from "@/lib/kakao";
import { useVoiceInput } from "@/lib/voice";
import { MicButton } from "./MicButton";

const DEBOUNCE_MS = 320;

/** 음성 모드의 화면 탭이 이 필드의 인식을 시작하기 위한 손잡이.
 *  화면을 못 보는 사람에게 마이크 버튼의 "위치"는 존재하지 않으므로, 조작은 화면 전체를
 *  덮는 탭 면이 받고 실제 인식은 이 손잡이를 통해 해당 필드가 수행한다. */
export interface VoiceHandle {
  start: () => void;
}

export function PlaceInput({
  label,
  placeholder,
  value,
  onPick,
  onClear,
  accentHex,
  voiceRef,
  onAnnounce,
  showMic = false,
}: {
  label: string;
  placeholder: string;
  value: KakaoPlace | null;
  /** source는 확정 복창을 누가 말할지 가른다 — 음성으로 들어온 경우에만 부모가
   *  "다음은 도착지입니다" 같은 다음 단계 안내까지 붙여서 낭독한다. */
  onPick: (p: KakaoPlace, source: "voice" | "manual") => void;
  onClear: () => void;
  accentHex: string;
  voiceRef?: React.RefObject<VoiceHandle | null>;
  /** 마이크는 음성 모드(`?voice=1`)에서만 노출한다. 일반 모드는 타이핑 검색만 쓴다. */
  showMic?: boolean;
  /** 이 문장을 소리로 내보낸다. done을 주면 다 말한 뒤에 부른다.
   *  음성 안내가 꺼져 있거나 낭독이 불가능한 기기에서도 done은 반드시 불린다. */
  onAnnounce?: (text: string, done?: () => void) => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<KakaoPlace[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Guards against an earlier, slower response overwriting a newer one.
  const seqRef = useRef(0);
  /** 음성 경로가 이미 검색을 보냈으면 디바운스 검색을 한 번 건너뛴다 (중복 요청 방지). */
  const skipDebounceRef = useRef(false);

  const uid = useId();
  const inputId = `place-input-${uid}`;
  const statusId = `place-status-${uid}`;
  const listId = `place-list-${uid}`;

  // 안내 → (다 말한 뒤) 마이크 열기 → 3초 무음이면 다시 청하기, 3회째엔 멈추기.
  // 이 순서와 재시도 정책은 훅이 들고 있다.
  const voice = useVoiceInput({
    onResult: (t) => void runVoiceSearch(t),
    prompt: `${label}, 말씀하세요.`,
    announce: onAnnounce,
  });

  // 값이 이미 들어와 마이크 버튼이 화면에서 사라진 뒤에도 손잡이는 살아 있어야 한다 —
  // 길게 누르기로 "직전 단계 다시 말하기"를 하면 확정된 필드를 덮어써야 하기 때문이다.
  useEffect(() => {
    if (!voiceRef) return;
    voiceRef.current = { start: voice.toggle };
    return () => {
      voiceRef.current = null;
    };
  });

  // 오류만 여기서 소리로 낸다.
  //
  //  · 안내("말씀하세요")는 startWithPrompt가 이미 말했다.
  //  · "검색 중"은 화면에만 남는다 — 카카오 검색이 300~600ms라 그 문장을 말하는 동안
  //    결과가 도착해 복창과 겹친다.
  //  · 확정 복창은 부모(BookingApp)가 말한다. "다음은 도착지" 같은 다음 단계 안내를
  //    붙이려면 단계 카운터를 아는 쪽이어야 하기 때문이다.
  // 음성 모드를 끄는 순간 열려 있던 마이크도 닫는다 — 안 닫으면 화면에는 아무 표시가
  // 없는데 브라우저는 계속 듣고 있고, 3초 뒤 무음 재시도까지 말한다.
  const toggleRef = useRef(voice.toggle);
  toggleRef.current = voice.toggle;
  useEffect(() => {
    if (!showMic && voice.listening) toggleRef.current();
  }, [showMic, voice.listening]);

  const announcedRef = useRef("");
  useEffect(() => {
    // 마이크를 다시 열면 같은 오류를 또 말할 수 있어야 한다 — 3초 무음이 두 번 연속
    // 나는 것은 흔하고, 두 번째에 침묵하면 고장으로 보인다.
    if (voice.listening) announcedRef.current = "";
  }, [voice.listening]);
  useEffect(() => {
    if (!voice.error || voice.error === announcedRef.current) return;
    announcedRef.current = voice.error;
    onAnnounce?.(voice.error);
  }, [voice.error, onAnnounce]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setErr(null);
      setBusy(false);
      return;
    }
    if (skipDebounceRef.current) {
      skipDebounceRef.current = false;
      return;
    }
    const seq = ++seqRef.current;
    setBusy(true);
    const timer = window.setTimeout(async () => {
      try {
        const found = await searchPlaces(q);
        if (seq !== seqRef.current) return;
        setHits(found);
        setErr(found.length === 0 ? "검색 결과가 없습니다" : null);
        setOpen(true);
      } catch (e) {
        if (seq !== seqRef.current) return;
        setHits([]);
        setErr(e instanceof Error ? e.message : "검색에 실패했습니다");
        setOpen(true);
      } finally {
        if (seq === seqRef.current) setBusy(false);
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  // Click-away closes the suggestion list.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const pick = (p: KakaoPlace) => {
    onPick(p, "manual");
    setQuery("");
    setHits([]);
    setOpen(false);
    setErr(null);
  };

  /** 말한 한 마디로 검색하고 최상위 후보를 채택한다.
   *  디바운스를 타지 않고 바로 보낸다 — 320ms는 1분 예산에서 아깝고, 어차피 확정된
   *  한 문장이라 더 기다릴 이유가 없다. */
  async function runVoiceSearch(transcript: string) {
    const q = transcript.trim();
    if (!q) return;

    skipDebounceRef.current = true;
    setQuery(q);
    setErr(null);
    setBusy(true);
    const seq = ++seqRef.current;

    try {
      const found = await searchPlaces(q);
      if (seq !== seqRef.current) return;
      if (found.length === 0) {
        setHits([]);
        setErr(`"${q}" 검색 결과가 없습니다. 마이크를 다시 누르고 말씀해 주세요.`);
        setOpen(true);
        return;
      }
      setHits(found);
      onPick(found[0], "voice");
      setQuery("");
      setOpen(false);
    } catch (e) {
      if (seq !== seqRef.current) return;
      setHits([]);
      setErr(e instanceof Error ? e.message : "검색에 실패했습니다");
      setOpen(true);
    } finally {
      if (seq === seqRef.current) setBusy(false);
    }
  }

  const clear = () => {
    onClear();
    setErr(null);
  };

  /** 후보 버튼 사이 화살표 이동. 목록 DOM을 직접 읽어 인덱스 상태를 따로 들지 않는다. */
  const options = () =>
    listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-opt]") ?? null;

  const focusOption = (i: number) => {
    const btns = options();
    if (!btns || btns.length === 0) return;
    btns[(i + btns.length) % btns.length].focus();
  };

  // 소리로 나가는 한 줄. 짧게 유지하는 것이 규격이다 —
  // "검색 중"은 여기 없다. 카카오 검색은 보통 300~600ms인데 그 문장(1.2초)을 말하는
  // 동안 이미 결과가 도착해 확정 복창과 겹치거나 복창을 밀어낸다. 화면에만 남긴다.
  //
  // 음성에서 나온 문구는 음성 모드가 꺼지면 함께 사라진다(showMic로 가른다) — 마이크가
  // 없는 화면에 "새로고침 후 다시 말씀해 주세요"만 남으면 무엇을 하라는 말인지 알 수 없다.
  const status = showMic && voice.error
    ? voice.error
    : showMic && voice.listening
      ? `${label}, 말씀하세요.`
      : err
        ? err
        : value
          ? `${label}, ${value.name}`
          : hits.length > 0
            ? `검색 결과 ${hits.length}곳. 목록에서 선택하세요.`
            : "";

  return (
    <div ref={boxRef} className="relative">
      {/* value가 있으면 input이 사라진다 — 그때 htmlFor가 가리킬 대상이 없으므로
          label 요소 자체를 쓰지 않는다. */}
      {value ? (
        <p className="mb-1.5 flex items-center gap-1.5 text-[12px] text-dim lg:mb-1 lg:text-[11px]">
          <Dot hex={accentHex} />
          {label}
        </p>
      ) : (
        <label
          htmlFor={inputId}
          className="mb-1.5 flex items-center gap-1.5 text-[12px] text-dim lg:mb-1 lg:text-[11px]"
        >
          <Dot hex={accentHex} />
          {label}
        </label>
      )}

      {value ? (
        <div className="flex items-center gap-2 rounded-xl border border-line bg-panel px-3.5 py-2.5 lg:items-start lg:rounded-lg lg:px-3 lg:py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14.5px] font-medium lg:text-[13px]">{value.name}</p>
            {value.address && (
              <p className="truncate text-[12px] text-dim lg:text-[11px]">{value.address}</p>
            )}
          </div>
          <button
            type="button"
            onClick={clear}
            aria-label={`${label} 변경 — ${value.name} 지우고 다시 입력`}
            className="shrink-0 rounded-lg border border-line px-3 py-2 text-[12.5px] text-dim transition-colors hover:bg-line hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent lg:rounded lg:border-0 lg:px-1.5 lg:py-0.5 lg:text-[11px]"
          >
            변경
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <input
              ref={inputRef}
              id={inputId}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => hits.length > 0 && setOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" && hits.length > 0) {
                  e.preventDefault();
                  setOpen(true);
                  focusOption(0);
                } else if (e.key === "Escape") {
                  setOpen(false);
                }
              }}
              placeholder={placeholder}
              inputMode="search"
              autoComplete="off"
              aria-describedby={statusId}
              // 폰에서 16px — 그보다 작으면 모바일 사파리가 포커스 순간 페이지를
              // 확대해버려 레이아웃이 튄다. 높이는 옆 마이크 버튼(44px)에 맞춘다.
              className="h-11 w-full rounded-xl border border-line bg-panel px-3.5 text-[16px] outline-none transition-colors placeholder:text-dim/70 focus:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent lg:h-auto lg:rounded-lg lg:px-3 lg:py-2 lg:text-[13px]"
            />
            {busy && (
              <span
                aria-hidden
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-dim"
              >
                검색 중…
              </span>
            )}
          </div>
          {showMic && (
            <MicButton
              label={`${label} 음성으로 입력`}
              listening={voice.listening}
              supported={voice.supported}
              onToggle={voice.toggle}
            />
          )}
        </div>
      )}

      {/* 상태 한 줄. TTS를 끈 스크린리더 사용자에게는 이쪽이 유일한 통로다.
          화면에도 남긴다 — 발표자가 지금 무엇이 들렸는지 눈으로 확인해야 한다. */}
      <p
        id={statusId}
        role="status"
        aria-live="polite"
        className="mt-1.5 min-h-[16px] text-[12.5px] leading-snug text-accent empty:mt-0 empty:min-h-0 lg:mt-1 lg:min-h-[14px] lg:text-[11px]"
      >
        {status}
      </p>

      {open && !value && (hits.length > 0 || err) && (
        <ul
          ref={listRef}
          id={listId}
          aria-label={`${label} 검색 결과`}
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-line bg-panel shadow-lg"
        >
          {err && hits.length === 0 ? (
            <li className="px-3.5 py-3 text-[13.5px] text-dim lg:px-3 lg:py-2 lg:text-[12px]">
              {err}
            </li>
          ) : (
            hits.map((p, i) => (
              <li key={`${p.name}-${p.coord[0]}-${p.coord[1]}-${i}`}>
                <button
                  type="button"
                  data-opt
                  onClick={() => pick(p)}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      focusOption(i + 1);
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      if (i === 0) inputRef.current?.focus();
                      else focusOption(i - 1);
                    } else if (e.key === "Escape") {
                      setOpen(false);
                      inputRef.current?.focus();
                    }
                  }}
                  aria-label={`${label}로 ${p.name} 선택${p.address ? `, ${p.address}` : ""}`}
                  className="w-full px-3.5 py-3 text-left transition-colors hover:bg-line focus-visible:bg-line focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent lg:px-3 lg:py-2"
                >
                  <span className="block truncate text-[14.5px] lg:text-[13px]">{p.name}</span>
                  {p.address && (
                    <span className="block truncate text-[12px] text-dim lg:text-[11px]">
                      {p.address}
                    </span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function Dot({ hex }: { hex: string }) {
  return (
    <span
      className="h-2 w-2 rounded-full"
      style={{ background: hex }}
      aria-hidden
    />
  );
}
