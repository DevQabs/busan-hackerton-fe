"use client";

// 시간대 격차: 일반인 이동 비중(회색 면) vs 두리발 접수 비중(시안 면).
// 저녁 구간에서 두 면이 벌어지는 모양 자체가 "교통약자의 저녁이 사라진다"의
// 증거다. 값은 각 24시간 합=100%인 '비중'이라 절대량 비교가 아니다.

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DongCompareHour } from "@/lib/typesDongCompare";
import { HEX } from "@/lib/palette";
import {
  TICK,
  TOOLTIP_CONTENT_STYLE,
  TOOLTIP_ITEM_STYLE,
  TOOLTIP_LABEL_STYLE,
} from "./theme";

export function HourGapArea({ hours }: { hours: DongCompareHour[] }) {
  const data = hours.map((h) => ({
    hour: h.hour,
    일반인: +(h.generalShare * 100).toFixed(2),
    두리발: +(h.duribalShare * 100).toFixed(2),
  }));
  return (
    <ResponsiveContainer width="100%" height={148}>
      <AreaChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
        <defs>
          <linearGradient id="hg-duribal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={HEX.accent} stopOpacity={0.45} />
            <stop offset="100%" stopColor={HEX.accent} stopOpacity={0.04} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--line)" strokeOpacity={0.4} vertical={false} />
        <XAxis
          dataKey="hour"
          ticks={[0, 6, 12, 18, 21, 23]}
          tick={TICK}
          tickLine={false}
          axisLine={false}
          tickFormatter={(h) => `${h}시`}
        />
        <YAxis
          tick={TICK}
          tickLine={false}
          axisLine={false}
          unit="%"
          width={44}
        />
        <Tooltip
          contentStyle={TOOLTIP_CONTENT_STYLE}
          labelStyle={TOOLTIP_LABEL_STYLE}
          itemStyle={TOOLTIP_ITEM_STYLE}
          labelFormatter={(h) => `${h}시 이동 비중`}
          formatter={(v: number) => [`${v}%`]}
        />
        <ReferenceLine x={21} stroke={HEX.unmet} strokeDasharray="4 3" />
        <Area
          type="monotone"
          dataKey="일반인"
          stroke={HEX.inkDim}
          strokeWidth={1.5}
          fill={HEX.inkDim}
          fillOpacity={0.14}
          isAnimationActive
          animationDuration={600}
        />
        <Area
          type="monotone"
          dataKey="두리발"
          stroke={HEX.accent}
          strokeWidth={2}
          fill="url(#hg-duribal)"
          isAnimationActive
          animationDuration={600}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
