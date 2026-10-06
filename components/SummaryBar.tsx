// Design Ref: §1 ③ 요약 — 이슈 수·분야별 수·마지막 업데이트 시각.
// 숫자는 화면에 보이는 결과(lastSuccess) 기준으로 센다. 0건·실패 여부는 상태 안내(②)가 알린다.
import { CATEGORIES } from "@/lib/categories";
import { formatKst } from "@/lib/format";
import type { SuccessResult } from "@/lib/types";

export default function SummaryBar({ result }: { result: SuccessResult | null }) {
  const issues = result?.issues ?? [];

  // 이슈 하나가 분야 2개에 걸칠 수 있어, 분야별 합은 전체 수보다 클 수 있다.
  const categoryCounts = CATEGORIES.map((category) => ({
    category,
    count: issues.filter((issue) => issue.categories.includes(category)).length,
  })).filter(({ count }) => count > 0);

  return (
    <section
      aria-label="오늘의 이슈 요약"
      className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-lg font-semibold">
          오늘의 이슈 <span className="text-2xl font-bold">{issues.length}</span>건
        </p>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          마지막 업데이트 {result ? formatKst(result.generatedAt) : "-"}
        </p>
      </div>

      {categoryCounts.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2 text-sm">
          {categoryCounts.map(({ category, count }) => (
            <li
              key={category}
              className="rounded-full bg-white px-3 py-1 ring-1 ring-zinc-200 dark:bg-zinc-800 dark:ring-zinc-700"
            >
              {category} <span className="font-semibold">{count}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
