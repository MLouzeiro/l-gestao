import { formatBRL } from "@/lib/money";
import type { DailyPoint } from "@/server/modules/dashboard/dashboard-rules";

// Gráfico de barras do faturamento diário — SVG/CSS puro (sem lib de
// gráficos), Server Component puro. Tooltip nativo via `title`.

function dayLabel(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

export function RevenueBars({ points }: { points: DailyPoint[] }) {
  if (points.length === 0) {
    return <p className="mt-3 text-sm text-slate-400">Sem dados.</p>;
  }
  const max = Math.max(...points.map((p) => p.netCents));
  const labelEvery = Math.max(1, Math.ceil(points.length / 8));

  return (
    <div className="mt-3">
      <div className="flex h-44 items-end gap-0.5 sm:gap-1">
        {points.map((p) => {
          const pct = max > 0 ? (p.netCents / max) * 100 : 0;
          return (
            <div
              key={p.day}
              className="group relative flex h-full flex-1 items-end"
              title={`${dayLabel(p.day)} — ${formatBRL(p.netCents)} · ${p.orders} venda(s)`}
            >
              {p.netCents > 0 && (
                <div
                  className="w-full rounded-t bg-indigo-500 transition-colors group-hover:bg-indigo-600"
                  style={{ height: `${Math.max(pct, 3)}%` }}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-0.5 text-[10px] text-slate-400 sm:gap-1">
        {points.map((p, i) => (
          <div key={p.day} className="flex-1 text-center">
            {i % labelEvery === 0 || i === points.length - 1
              ? dayLabel(p.day)
              : ""}
          </div>
        ))}
      </div>
    </div>
  );
}
