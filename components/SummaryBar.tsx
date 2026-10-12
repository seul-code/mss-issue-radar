// Design Ref: §1 ③ 요약 — 오늘의 이슈 수·중요도별 수·분야별 수를 통계 카드로 보여준다.
// 숫자는 화면에 보이는 결과(lastSuccess) 기준으로 센다. 0건·실패 여부는 상태 안내(②)가 알린다.
import CountUp from "@/components/CountUp";
import { CATEGORIES, CATEGORY_EMOJI } from "@/lib/categories";
import { formatKst } from "@/lib/format";
import type { Importance, SuccessResult } from "@/lib/types";

const IMPORTANCE_STATS: { key: Importance; label: string; icon: string; className: string }[] = [
  { key: "high", label: "높음", icon: "🔥", className: "bg-coral-100 text-coral-700" },
  { key: "medium", label: "보통", icon: "⭐", className: "bg-butter-100 text-butter-700" },
  { key: "low", label: "낮음", icon: "🌱", className: "bg-mint-50 text-mint-700" },
];

/** label: 과거 날짜 화면에서는 "이 날의 이슈"처럼 바꿔 쓴다 */
export default function SummaryBar({ result, label = "오늘의 이슈" }: { result: SuccessResult | null; label?: string }) {
  const issues = result?.issues ?? [];

  // 이슈 하나가 분야 2개에 걸칠 수 있어, 분야별 합은 전체 수보다 클 수 있다.
  const categoryCounts = CATEGORIES.map((category) => ({
    category,
    count: issues.filter((issue) => issue.categories.includes(category)).length,
  }))
    .filter(({ count }) => count > 0)
    .sort((a, b) => b.count - a.count);
  const maxCount = Math.max(1, ...categoryCounts.map(({ count }) => count));

  return (
    <section aria-label={`${label} 요약`} className="space-y-3">
      {/* 휴대폰: 총건수 한 줄 + 중요도 3칸 / 넓은 화면: 4칸 한 줄 */}
      <div className="grid grid-cols-3 gap-3 md:grid-cols-4">
        {/* 총건수 */}
        <div className="col-span-3 rounded-3xl bg-lavender-100 p-4 shadow-soft md:col-span-1">
          <p className="text-sm font-semibold text-lavender-700">📰 {label}</p>
          <p className="mt-1 font-display text-4xl text-ink">
            <CountUp value={issues.length} />
            <span className="ml-1 text-xl">건</span>
          </p>
          <p className="mt-1 text-[13px] text-ink-soft">
            마지막 업데이트 {result ? formatKst(result.generatedAt) : "-"}
          </p>
          {/* 집계 기준: 이 결과가 어느 기간의 자료로 만들어졌는지 */}
          {result?.window && (
            <p className="text-[13px] text-ink-soft">
              집계 {formatKst(result.window.from)} ~ {formatKst(result.window.to)} ({result.window.hours}시간)
            </p>
          )}
        </div>

        {/* 중요도별 */}
        {IMPORTANCE_STATS.map(({ key, label, icon, className }) => (
          <div key={key} className={`rounded-3xl p-3 shadow-soft sm:p-4 ${className}`}>
            <p className="whitespace-nowrap text-xs font-semibold sm:text-sm">
              {icon} <span className="sr-only">중요도 </span>
              {label}
            </p>
            {/* 카운트업은 총건수에만 쓰고, 중요도 숫자는 바로 보여준다 (움직임 최소화) */}
            <p className="mt-1 font-display text-2xl sm:text-3xl">
              {issues.filter((issue) => issue.importance === key).length}
              <span className="ml-1 text-base sm:text-lg">건</span>
            </p>
          </div>
        ))}
      </div>

      {/* 분야별: 막대 그래프 — 아래 분야 칩과 정보가 겹쳐 기본은 접어 둔다 */}
      {categoryCounts.length > 0 && (
        <details className="group rounded-3xl bg-cream px-4 py-3 shadow-soft">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-mint-700 [&::-webkit-details-marker]:hidden">
            <span aria-hidden="true" className="transition-transform duration-200 group-open:rotate-90">
              ▸
            </span>
            📊 분야별 이슈 {categoryCounts.length}개 분야 보기
          </summary>
          <ul className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {categoryCounts.map(({ category, count }) => (
              <li key={category} className="flex items-center gap-2 text-sm">
                <span className="w-24 shrink-0 truncate">
                  {CATEGORY_EMOJI[category]} {category}
                </span>
                <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-mint-50">
                  <span
                    className="block h-full rounded-full bg-mint-300"
                    style={{ width: `${(count / maxCount) * 100}%` }}
                  />
                </span>
                <span className="w-6 text-right font-semibold tabular-nums">{count}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[13px] text-ink-soft">
            ⓘ 이슈 1건이 분야 2개에 걸칠 수 있어, 분야별 합계가 전체 건수보다 클 수 있어요.
          </p>
        </details>
      )}
    </section>
  );
}
