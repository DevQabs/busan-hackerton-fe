"use client";

// 접근성 사각지대 step-1: 선택한 비교 지표 기준 해운대 18개 동 랭킹.
// 가로 막대 · 클릭 = 동 선택 · 선택 동은 시안 테두리로 강조.

import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { HEX } from "@/lib/palette";
import {
  CURSOR_FILL,
  TICK,
  TOOLTIP_CONTENT_STYLE,
  TOOLTIP_ITEM_STYLE,
  TOOLTIP_LABEL_STYLE,
} from "./theme";

export interface RankRow {
  name: string;
  value: number;
  /** pre-formatted value for tooltip/label (e.g. "7,358건", "25.0%", "-3.1%p") */
  label: string;
}

export function DongCompareRank({
  rows,
  color,
  selected,
  onSelect,
  unit,
}: {
  rows: RankRow[];
  color: string;
  selected: string | null;
  onSelect: (name: string) => void;
  unit: string;
}) {
  // 음수 지표(격차)도 막대 길이로 읽히도록 |value| 기준 스케일
  const data = rows.map((r) => ({ ...r, mag: Math.abs(r.value) }));
  return (
    <ResponsiveContainer width="100%" height={Math.max(180, rows.length * 24)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 2, right: 44, bottom: 2, left: 0 }}
        onClick={(st) => {
          const name = st?.activeLabel;
          if (typeof name === "string" && name) onSelect(name);
        }}
      >
        <XAxis type="number" dataKey="mag" hide domain={[0, "dataMax"]} />
        <YAxis
          type="category"
          dataKey="name"
          width={62}
          tickLine={false}
          axisLine={false}
          tick={{ ...TICK, fontSize: 10.5 }}
          interval={0}
        />
        <Tooltip
          contentStyle={TOOLTIP_CONTENT_STYLE}
          labelStyle={TOOLTIP_LABEL_STYLE}
          itemStyle={TOOLTIP_ITEM_STYLE}
          cursor={CURSOR_FILL}
          formatter={(_v, _n, item) => [
            (item?.payload as RankRow | undefined)?.label ?? "",
            unit,
          ]}
        />
        <Bar
          dataKey="mag"
          radius={[0, 4, 4, 0]}
          isAnimationActive
          animationDuration={550}
          cursor="pointer"
        >
          {data.map((r) => (
            <Cell
              key={r.name}
              fill={color}
              fillOpacity={selected === r.name ? 1 : 0.55}
              stroke={selected === r.name ? HEX.accent : "transparent"}
              strokeWidth={selected === r.name ? 1.5 : 0}
            />
          ))}
          <LabelList
            dataKey="label"
            position="right"
            style={{ fill: "var(--ink-dim)", fontSize: 9.5 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
