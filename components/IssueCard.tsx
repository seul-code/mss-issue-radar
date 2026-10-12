// Design Ref: §1 ⑤ 이슈 카드 — PRD 5장 카드 9개 항목을 모두 보여주되, 훑어보기 쉽게 세 영역으로 나눈다.
//   기본: 중요도·분야 → 제목 → 출처·날짜 → 핵심 요약 3줄 → ✨ AI 인사이트(중기부 연관성) → 원문 링크
//   '상세 분석 보기'(펼치기): 핵심 요약 4~5줄 · 업무 활용 아이디어 · 추가 확인사항
// 상호작용은 기본 <details> 요소와 CSS만 쓰므로 서버·클라이언트 어디서든 쓸 수 있다.
import type { CSSProperties } from "react";
import { CATEGORY_EMOJI } from "@/lib/categories";
import { formatKst } from "@/lib/format";
import type { Importance, Issue } from "@/lib/types";

/** 중요도는 색 + 아이콘 + 글자를 함께 써서 색을 구분하기 어려워도 알아볼 수 있게 한다. */
const IMPORTANCE_STYLE: Record<Importance, { text: string; icon: string; badge: string; edge: string }> = {
  high: { text: "높음", icon: "🔥", badge: "bg-coral-100 text-coral-600", edge: "border-l-coral-300" },
  medium: { text: "보통", icon: "⭐", badge: "bg-butter-100 text-butter-600", edge: "border-l-butter-100" },
  low: { text: "낮음", icon: "🌱", badge: "bg-mint-50 text-mint-600", edge: "border-l-mint-100" },
};

/** 기본으로 보여줄 핵심 요약 줄 수 (나머지는 '상세 분석 보기' 안) */
const VISIBLE_POINTS = 3;

/** 기사 사실과 구분하기 위해 AI가 만든 내용에 붙이는 표시 (PRD 5장) */
function AiBadge() {
  return (
    <span className="rounded-full bg-lavender-600 px-2 py-0.5 text-[11px] font-semibold text-white">AI 분석</span>
  );
}

function SummaryList({ points }: { points: string[] }) {
  return (
    <ul className="space-y-1.5 text-[15px] leading-6">
      {points.map((point) => (
        <li key={point} className="flex gap-2">
          <span aria-hidden="true" className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-mint-300" />
          <span>{point}</span>
        </li>
      ))}
    </ul>
  );
}

export default function IssueCard({ issue, style }: { issue: Issue; style?: CSSProperties }) {
  const importance = IMPORTANCE_STYLE[issue.importance];
  // 예전 형식(한 문장)으로 저장된 결과도 깨지지 않게 목록으로 맞춘다
  const points = ([] as string[]).concat(issue.summary);
  const morePoints = points.slice(VISIBLE_POINTS);

  return (
    <article
      style={style}
      className={`flex animate-rise flex-col gap-3 rounded-3xl border-l-4 bg-cream p-5 shadow-soft transition duration-200 hover:-translate-y-0.5 hover:shadow-lift ${importance.edge}`}
    >
      {/* 3. 중요도 · 4. 분야 */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className={`rounded-full px-2.5 py-1 font-bold ${importance.badge}`}>
          {importance.icon} 중요도 {importance.text}
        </span>
        {issue.categories.map((category) => (
          <span key={category} className="rounded-full bg-ivory px-2.5 py-1 font-medium text-ink-soft">
            {CATEGORY_EMOJI[category]} {category}
          </span>
        ))}
      </div>

      {/* 1. 제목 · 2. 출처·날짜 */}
      <div>
        <h2 className="text-[17px] font-bold leading-snug text-ink">{issue.title}</h2>
        <p className="mt-1 text-xs text-ink-soft">
          {issue.sourceName} · <time dateTime={issue.publishedAt}>{formatKst(issue.publishedAt)}</time>
        </p>
      </div>

      {/* 5. 핵심내용 — 기사 사실, 앞 3줄 */}
      <section aria-label="핵심내용">
        <SummaryList points={points.slice(0, VISIBLE_POINTS)} />
      </section>

      {/* 6. 중기부 연관성 — AI 인사이트 영역 */}
      <section aria-label="AI 인사이트" className="rounded-2xl bg-lavender-50 p-3.5 ring-1 ring-lavender-100">
        <p className="flex items-center gap-1.5 text-xs font-bold text-lavender-600">
          ✨ AI 인사이트 <AiBadge />
        </p>
        <p className="mt-1.5 text-sm leading-6">
          <span className="font-semibold text-lavender-600">중기부 연관성 </span>
          {issue.relevance}
        </p>
      </section>

      {/* 펼치기: 나머지 핵심내용 · 7. 업무 활용 아이디어 · 8. 추가 확인사항 */}
      <details className="group rounded-2xl bg-ivory/70">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3.5 py-2.5 text-sm font-semibold text-ink-soft hover:text-lavender-600 [&::-webkit-details-marker]:hidden">
          <span aria-hidden="true" className="transition-transform duration-200 group-open:rotate-90">
            ▸
          </span>
          상세 분석 보기
        </summary>
        <div className="space-y-3 px-3.5 pb-3.5">
          {morePoints.length > 0 && <SummaryList points={morePoints} />}

          <div className="rounded-2xl bg-lavender-50 p-3 ring-1 ring-lavender-100">
            <p className="flex items-center gap-1.5 text-xs font-bold text-lavender-600">
              💡 업무 활용 아이디어 <AiBadge />
            </p>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm leading-6">
              {issue.ideas.map((idea) => (
                <li key={idea}>{idea}</li>
              ))}
            </ul>
          </div>

          {/* 추가 확인사항이 없으면 칸 자체를 숨긴다 */}
          {issue.followUp && (
            <div className="rounded-2xl bg-mint-50 p-3">
              <p className="text-xs font-bold text-mint-600">🔎 추가 확인사항</p>
              <p className="mt-1 text-sm leading-6">{issue.followUp}</p>
            </div>
          )}
        </div>
      </details>

      {/* 9. 원문 링크 — 새 탭 */}
      <a
        href={issue.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-auto self-end rounded-full bg-mint-100 px-3.5 py-1.5 text-sm font-semibold text-mint-600 transition-colors hover:bg-mint-300 hover:text-ink"
      >
        원문 보기 ↗
      </a>
    </article>
  );
}
