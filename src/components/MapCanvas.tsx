"use client";

import { useRef, useState } from "react";
import { Map, NavigationControl, useControl } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { MapboxOverlayProps } from "@deck.gl/mapbox";
import DeckGL from "@deck.gl/react";
import type { MapSpec } from "@/lib/mapspec";
import "maplibre-gl/dist/maplibre-gl.css";

const BASEMAP_STYLE =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

export const INITIAL_VIEW = {
  longitude: 129.06,
  latitude: 35.18,
  zoom: 10.8,
  pitch: 30,
  bearing: 0,
};

/** deck.gl overlay mounted as a maplibre IControl (non-interleaved). */
function DeckOverlay(props: MapboxOverlayProps) {
  const overlay = useControl<MapboxOverlay>(
    () => new MapboxOverlay({ ...props, interleaved: false }),
  );
  overlay.setProps(props);
  return null;
}

export function MapCanvas({ spec }: { spec: MapSpec }) {
  // If the CARTO basemap cannot load (offline demo), fall back to a bare
  // DeckGL canvas on the dark background — all data layers keep working.
  const [basemapOk, setBasemapOk] = useState(true);
  const styleLoadedRef = useRef(false);

  if (!basemapOk) {
    return (
      <div className="absolute inset-0" style={{ background: "var(--bg)" }}>
        <DeckGL
          initialViewState={INITIAL_VIEW}
          controller={true}
          layers={spec.layers}
          getTooltip={spec.getTooltip}
        />
        <div className="pointer-events-none absolute bottom-2 right-2 rounded bg-panel/80 px-2 py-1 text-[10px] text-dim">
          베이스맵 오프라인 — 데이터 레이어만 표시 중
        </div>
      </div>
    );
  }

  return (
    <Map
      initialViewState={INITIAL_VIEW}
      mapStyle={BASEMAP_STYLE}
      style={{ position: "absolute", inset: 0, background: "var(--bg)" }}
      onLoad={() => {
        styleLoadedRef.current = true;
      }}
      onError={() => {
        // Errors before the style finished loading = basemap unreachable.
        if (!styleLoadedRef.current) setBasemapOk(false);
      }}
    >
      <NavigationControl position="bottom-right" visualizePitch />
      <DeckOverlay layers={spec.layers} getTooltip={spec.getTooltip} />
    </Map>
  );
}
