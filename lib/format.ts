// Number / time formatting helpers (ko-KR).

const nf = new Intl.NumberFormat("ko-KR");

/** 37512 → "37,512" */
export function fmt(n: number): string {
  return nf.format(Math.round(n));
}

/** 0.094 → "9.4%" */
export function pct(ratio: number, digits = 1): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}

/** seconds-of-day → "07:35" */
export function hhmm(sec: number): string {
  const s = ((sec % 86400) + 86400) % 86400;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "사상구 학장동" → "학장동" (keep last token for compact labels) */
export function shortDong(full: string): string {
  const parts = full.trim().split(/\s+/);
  return parts[parts.length - 1] ?? full;
}

export function signed(n: number, digits = 2): string {
  const v = n.toFixed(digits);
  return n > 0 ? `+${v}` : v;
}
