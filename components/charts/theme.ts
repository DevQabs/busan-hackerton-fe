// Shared recharts styling for the dark panel surface.

import type { CSSProperties } from "react";

export const TICK = { fill: "var(--ink-dim)", fontSize: 10 } as const;

export const TOOLTIP_CONTENT_STYLE: CSSProperties = {
  backgroundColor: "rgba(18, 24, 38, 0.96)",
  border: "1px solid var(--line)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--ink)",
  padding: "6px 10px",
};

export const TOOLTIP_LABEL_STYLE: CSSProperties = {
  color: "var(--ink-dim)",
  fontSize: 11,
  marginBottom: 2,
};

export const TOOLTIP_ITEM_STYLE: CSSProperties = {
  color: "var(--ink)",
  padding: 0,
};

export const CURSOR_FILL = { fill: "rgba(139, 150, 171, 0.08)" } as const;
