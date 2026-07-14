// Pure helpers for reading model_results.json inside scene components.
// Keep these tolerant: numbers is Record<string, number | string> and the
// pipeline may re-emit with slightly different keys at the finals.

import type { ModelResult } from "@/lib/types";
import type { RGBA } from "@/lib/palette";

export function findModel(
  results: ModelResult[] | null,
  id: string,
): ModelResult | null {
  return results?.find((m) => m.id === id) ?? null;
}

/** Safe numeric read from ModelResult.numbers ("<0.0001" strings → null). */
export function modelNumber(m: ModelResult | null, key: string): number | null {
  const v = m?.numbers?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export interface IrrBand {
  irr: number;
  lo: number;
  hi: number;
}

/** IRR of the charger coefficient from the NB regression (+1 charger →
 *  dropoffs ×irr, 95% CI [lo, hi]). Falls back over key spellings so a
 *  pipeline rename does not silently break the simulation. */
export function chargerIrr(results: ModelResult[] | null): IrrBand | null {
  const m = findModel(results, "nb-regression");
  if (!m) return null;
  const irr =
    modelNumber(m, "irr_chargers") ?? modelNumber(m, "irr") ?? null;
  if (irr === null) return null;
  const lo =
    modelNumber(m, "irr_chargers_lo") ?? modelNumber(m, "irrLo") ?? irr;
  const hi =
    modelNumber(m, "irr_chargers_hi") ?? modelNumber(m, "irrHi") ?? irr;
  return { irr, lo, hi };
}

/** "8.74–9.98" style CI text (Korean UI uses an en dash). */
export function ciText(ci: [number, number] | null, digits = 2): string {
  if (!ci) return "—";
  return `${ci[0].toFixed(digits)}–${ci[1].toFixed(digits)}`;
}

// ── diverging fill for suppressedZ ─────────────────────────────────────────
// Strongly NEGATIVE residual (observed ≪ expected) = suppressed-demand
// hotspot → deep warm. Near zero → neutral dark. Positive → cool, dimmed.

const NEUTRAL: [number, number, number] = [30, 37, 56];
const WARM: [number, number, number] = [229, 72, 77]; // matches gapHL red
const COOL: [number, number, number] = [34, 148, 189];

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

/** z → RGBA, clamped at ±maxAbs (pass the data-driven max |suppressedZ|). */
export function suppressedFill(z: number, maxAbs: number): RGBA {
  const span = maxAbs > 0 ? maxAbs : 1;
  const t = Math.min(Math.abs(z) / span, 1);
  const target = z < 0 ? WARM : COOL;
  // Negative side gets full saturation + opacity (that IS the signal);
  // positive side stays visually quiet so it never competes.
  const strength = z < 0 ? t : t * 0.55;
  return [
    lerp(NEUTRAL[0], target[0], strength),
    lerp(NEUTRAL[1], target[1], strength),
    lerp(NEUTRAL[2], target[2], strength),
    z < 0 ? Math.round(140 + t * 100) : Math.round(110 + t * 60),
  ];
}

/** CSS gradient string for the latent-mode legend (warm → neutral → cool). */
export const SUPPRESSED_GRADIENT = `linear-gradient(to right, rgb(${WARM.join(
  ",",
)}), rgb(${NEUTRAL.join(",")}), rgb(${COOL.map((c) => Math.round(c * 0.8)).join(",")}))`;
