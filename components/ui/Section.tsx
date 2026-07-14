import type { ReactNode } from "react";

/** Right-panel section: small caps-style title + boxed content. */
export function Section({
  title,
  aside,
  children,
  flush,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  flush?: boolean; // no inner padding (tables, lists)
}) {
  return (
    <section className="rounded-lg border border-line bg-panel">
      <header className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
        <h3 className="text-[12px] font-semibold tracking-wide text-ink">{title}</h3>
        {aside && <div className="text-[11px] text-dim">{aside}</div>}
      </header>
      <div className={flush ? "" : "px-3.5 py-3"}>{children}</div>
    </section>
  );
}
