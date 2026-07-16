"use client";

import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { pct } from "@/lib/format";
import { HEX } from "@/lib/palette";
import {
  CURSOR_FILL,
  TICK,
  TOOLTIP_CONTENT_STYLE,
  TOOLTIP_ITEM_STYLE,
  TOOLTIP_LABEL_STYLE,
} from "./theme";

/** 유형별 등록 구성비(파랑) vs 두리발 이용 구성비(청록) grouped 가로 바.
 *  절대 수가 아니라 각 분포 안에서의 비중(0..1)이라 두 축이 비교 가능하다.
 *  등록 비중 내림차순, 상위 maxRows개 유형만 표시. */
export function TypeCompareBar({
  data,
  maxRows = 10,
}: {
  data: { type: string; regShare: number; tripShare: number }[];
  maxRows?: number;
}) {
  const rows = [...data]
    .sort((a, b) => b.regShare - a.regShare)
    .slice(0, maxRows)
    .map((d) => ({ label: d.type, ...d }));
  const height = rows.length * 30 + 28;

  if (rows.length === 0) return null;

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: -8 }}>
          <XAxis
            type="number"
            tick={TICK}
            tickLine={false}
            axisLine={false}
            height={20}
            tickFormatter={(v) => pct(Number(v), 0)}
          />
          <YAxis
            type="category"
            dataKey="label"
            tick={{ ...TICK, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={64}
          />
          <Tooltip
            cursor={CURSOR_FILL}
            contentStyle={TOOLTIP_CONTENT_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
            itemStyle={TOOLTIP_ITEM_STYLE}
            formatter={(v, name) => [
              pct(Number(v)),
              name === "regShare" ? "등록 구성비" : "이용 구성비",
            ]}
          />
          <Bar dataKey="regShare" fill={HEX.demand} fillOpacity={0.8} maxBarSize={9} />
          <Bar dataKey="tripShare" fill={HEX.accent} fillOpacity={0.8} maxBarSize={9} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
