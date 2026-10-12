"use client";
// Design Ref: §1 ④ 분야 필터 + ⑤ 카드 목록 — 사용자가 누르는 칩에 반응해야 해서 이 조각만 클라이언트에서 동작한다.
// 필터는 이미 받은 이슈 중에서 고르기만 하므로 서버 요청이나 AI 호출이 생기지 않는다.
import { useState } from "react";
import IssueCard from "@/components/IssueCard";
import { CATEGORIES, CATEGORY_EMOJI } from "@/lib/categories";
import type { Category, Issue } from "@/lib/types";

type Filter = "전체" | Category;

/** PRD 5장 분야 필터 11개: 전체 + 분야 10개 */
const FILTERS: readonly Filter[] = ["전체", ...CATEGORIES];

/** 카드가 차례로 나타나는 간격 (최대 0.4초까지만 늦춘다) */
const STAGGER_MS = 30;
const MAX_DELAY_MS = 400;

/** issues는 이미 정렬된 상태로 받는다. */
export default function IssueBoard({ issues }: { issues: Issue[] }) {
  const [selected, setSelected] = useState<Filter>("전체");

  const countOf = (filter: Filter) =>
    filter === "전체" ? issues.length : issues.filter((issue) => issue.categories.includes(filter)).length;
  const visible =
    selected === "전체" ? issues : issues.filter((issue) => issue.categories.includes(selected));

  return (
    <div>
      {/* 칩이 화면 폭에 맞춰 자동으로 줄바꿈된다 */}
      <nav aria-label="분야 필터">
        <ul className="flex flex-wrap gap-2">
          {FILTERS.map((filter) => {
            const isSelected = filter === selected;
            return (
              <li key={filter}>
                <button
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => setSelected(filter)}
                  className={`rounded-full px-3.5 py-1.5 text-sm font-medium shadow-soft transition-colors ${
                    isSelected
                      ? "bg-lavender-600 text-white"
                      : "bg-cream text-ink hover:bg-lavender-50"
                  }`}
                >
                  {filter === "전체" ? "✨" : CATEGORY_EMOJI[filter]} {filter}
                  <span className={`ml-1.5 text-xs ${isSelected ? "text-lavender-100" : "text-ink-soft"}`}>
                    {countOf(filter)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* 분야를 바꾸면 목록을 새로 그려 카드가 다시 부드럽게 나타난다 */}
      <div key={selected} className="mt-6 animate-fade">
        {visible.length > 0 ? (
          <div className="grid gap-5 md:grid-cols-2">
            {visible.map((issue, index) => (
              <IssueCard
                key={issue.id}
                issue={issue}
                style={{ animationDelay: `${Math.min(index * STAGGER_MS, MAX_DELAY_MS)}ms` }}
              />
            ))}
          </div>
        ) : (
          // 고른 분야에 이슈가 없을 때는 안내만 보여준다 (분야별 이전 결과는 저장하지 않음).
          <p className="rounded-3xl border-2 border-dashed border-line bg-cream p-8 text-center text-sm text-ink-soft">
            🫧 오늘은 새 이슈가 없습니다
          </p>
        )}
      </div>
    </div>
  );
}
