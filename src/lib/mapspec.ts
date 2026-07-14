// What a scene hands to the map: deck.gl layers + an optional tooltip fn.

import type { DeckProps, Layer } from "@deck.gl/core";

export interface MapSpec {
  layers: Layer[];
  getTooltip?: DeckProps["getTooltip"];
}

export const EMPTY_SPEC: MapSpec = { layers: [] };

/** Shared dark tooltip chrome for deck.gl getTooltip. */
export const TOOLTIP_STYLE: Partial<CSSStyleDeclaration> = {
  backgroundColor: "rgba(18, 24, 38, 0.96)",
  border: "1px solid #232b3d",
  borderRadius: "8px",
  color: "#e2e8f0",
  fontSize: "12px",
  lineHeight: "1.5",
  padding: "8px 10px",
  maxWidth: "280px",
  boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
};

export function tooltipHtml(html: string) {
  return { html, style: TOOLTIP_STYLE };
}

/** GeoJSON shapes for dongs.geojson (feature props typed via DongProps). */
export interface DongFeature<P> {
  type: "Feature";
  properties: P;
  geometry: { type: string; coordinates: unknown };
}

export interface DongCollection<P> {
  type: "FeatureCollection";
  features: DongFeature<P>[];
}
