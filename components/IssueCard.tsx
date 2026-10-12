// Design Ref: §1 ⑤ 이슈 카드 — PRD 5장 카드 9개 항목을 고정 순서로 보여준다.
// 상호작용이 없으므로 서버·클라이언트 어디서든 쓸 수 있는 일반 컴포넌트로 둔다.
import { formatKst } from "@/lib/format";
import type { Importance, Issue } from "@/lib/types";

const IMPORTANCE_LABEL: Record<Importance, { text: string; className: string }> = {
  high: { text: "높음", className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200" },
  medium: { text: "보통", className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200" },
  low: { text: "낮음", className: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
};

/** 기사의 사실과 구분하기 위해 AI가 만든 내용 앞에 붙이는 표시 (PRD 5장) */
function AiBadge() {
  return (
    <span className="ml-2 rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-medium text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">
      AI 분석
    </span>
  );
}

/** 카드 안의 한 칸: 작은 제목 + 내용 */
function Field({ label, badge, children }: { label: string; badge?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
        {label}
        {badge && <AiBadge />}
      </h3>
      <div className="mt-1 text-sm leading-6">{children}</div>
    </div>
  );
}

export default function IssueCard({ issue }: { issue: Issue }) {
  const importance = IMPORTANCE_LABEL[issue.importance];

  return (
    <article className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      {/* 1. 제목 */}
      <h2 className="text-base font-bold leading-snug">{issue.title}</h2>

      {/* 2. 날짜·출처 */}
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        <time dateTime={issue.publishedAt}>{formatKst(issue.publishedAt)}</time> · {issue.sourceName}
      </p>

      {/* 3. 중요도 · 4. 분야 */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded px-2 py-0.5 font-semibold ${importance.className}`}>
          중요도 {importance.text}
        </span>
        {issue.categories.map((category) => (
          <span key={category} className="rounded-full px-2 py-0.5 ring-1 ring-zinc-300 dark:ring-zinc-700">
            {category}
          </span>
        ))}
      </div>

      {/* 5. 핵심내용 — 원문 사실을 항목형 3~5줄로 */}
      <Field label="핵심내용">
        <ul className="list-disc space-y-1 pl-5">
          {/* 예전 형식(한 문장)으로 저장된 결과도 깨지지 않게 목록으로 맞춘다 */}
          {([] as string[]).concat(issue.summary).map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </Field>

      {/* 6. 중기부 연관성 (AI 분석) */}
      <Field label="중기부 연관성" badge>
        {issue.relevance}
      </Field>

      {/* 7. 업무 활용 아이디어 (AI 분석, 최대 2개) */}
      <Field label="업무 활용 아이디어" badge>
        <ul className="list-disc space-y-1 pl-5">
          {issue.ideas.map((idea) => (
            <li key={idea}>{idea}</li>
          ))}
        </ul>
      </Field>

      {/* 8. 추가 확인사항 — 없으면 칸 자체를 숨긴다 */}
      {issue.followUp && <Field label="추가 확인사항">{issue.followUp}</Field>}

      {/* 9. 원문 링크 — 새 탭 */}
      <a
        href={issue.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block text-sm font-medium text-indigo-700 underline underline-offset-2 hover:text-indigo-900 dark:text-indigo-300 dark:hover:text-indigo-100"
      >
        원문 보기 ↗
      </a>
    </article>
  );
}
