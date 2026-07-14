export function Kpi({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string; // hex — thin signal bar at the top of the tile
}) {
  return (
    <div className="rounded-lg border border-line bg-panel px-3.5 py-3">
      <div
        className="mb-2 h-0.5 w-6 rounded-full"
        style={{ background: color ?? "var(--accent)" }}
      />
      <div className="text-[11px] leading-4 text-dim">{label}</div>
      <div className="tnum mt-0.5 text-[21px] font-semibold leading-7 text-ink">
        {value}
      </div>
      {sub && <div className="tnum mt-0.5 text-[11px] leading-4 text-dim">{sub}</div>}
    </div>
  );
}
