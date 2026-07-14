/** Shown while an artifact in public/data/ is missing or unparsable.
 *  useData re-polls every 8s, so this resolves by itself once the
 *  pipeline writes the file. */
export function DataPending({ note }: { note?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-panel px-4 py-6 text-center">
      <div className="mx-auto mb-3 flex items-center justify-center gap-1.5">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent [animation-delay:200ms]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent [animation-delay:400ms]" />
      </div>
      <p className="text-[13px] font-medium text-ink">데이터 준비 중…</p>
      <p className="mt-1 text-[11px] leading-4 text-dim">
        {note ?? "파이프라인 산출물이 아직 없습니다. 생성되면 자동으로 표시됩니다."}
      </p>
    </div>
  );
}
