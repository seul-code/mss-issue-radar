"use client";
// Design Ref: §1 ④ 분야 필터 + ⑤ 카드 목록 — 사용자가 누르는 버튼에 반응해야 해서 이 조각만 클라이언트에서 동작한다.
// 필터는 이미 받은 이슈 중에서 고르기만 하므로 서버 요청이나 AI 호출이 생기지 않는다.
import { useState } from "react";
import IssueCard from "@/components/IssueCard";
import { CATEGORIES } from "@/lib/categories";
import type { Category, Issue } from "@/lib/types";

type Filter = "전체" | Category;

/** PRD 5장 분야 필터 11개: 전체 + 분야 10개 */
const FILTERS: readonly Filter[] = ["전체", ...CATEGORIES];

/** issues는 이미 정렬된 상태로 받는다. */
export default function IssueBoard({ issues }: { issues: Issue[] }) {
  const [selected, setSelected] = useState<Filter>("전체");

  const visible =
    selected === "전체" ? issues : issues.filter((issue) => issue.categories.includes(selected));

  return (
    <div>
      {/* 휴대폰에서는 가로로 밀어서 넘긴다. 페이지 전체에는 가로 스크롤이 생기지 않는다. */}
      <nav aria-label="분야 필터" className="-mx-4 overflow-x-auto px-4">
        <ul className="flex gap-2 pb-2">
          {FILTERS.map((filter) => {
            const isSelected = filter === selected;
            return (
              <li key={filter} className="shrink-0">
                <button
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => setSelected(filter)}
                  className={`rounded-full px-3 py-1.5 text-sm whitespace-nowrap ring-1 transition-colors ${
                    isSelected
                      ? "bg-zinc-900 text-white ring-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:ring-zinc-100"
                      : "ring-zinc-300 hover:bg-zinc-100 dark:ring-zinc-700 dark:hover:bg-zinc-800"
                  }`}
                >
                  {filter}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mt-4 space-y-4">
        {visible.length > 0 ? (
          visible.map((issue) => <IssueCard key={issue.id} issue={issue} />)
        ) : (
          // 고른 분야에 이슈가 없을 때는 안내만 보여준다 (분야별 이전 결과는 저장하지 않음).
          <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
            오늘은 새 이슈가 없습니다
          </p>
        )}
      </div>
    </div>
  );
}
