// Design Ref: §1 ⑤ 이슈 카드 — PRD 5장 카드 9개 항목을 모두 보여주되, 훑어보기 쉽게 짧게 구성한다.
//   기본: 중요도·분야·원문 링크 → 제목 → 출처·날짜 → 📄 기사 내용 3줄 → 🔍 AI 분석(중기부 연관성)
//   '상세 분석 보기'(펼치기): 기사 내용 4~5줄 · 🔗 근거 기사 · 🎯 중요도 판단 근거 · 💡 AI 제안(업무 활용 아이디어) · 🔎 추가 확인사항
//   기사 내용 줄 끝의 [번호]는 근거 기사 번호, "수치 확인 필요"는 원문에서 같은 값을 찾지 못했다는 코드 점검 표시다 (사실 검증 보장 아님).
// 기사 사실 / AI 분석(추정) / AI 제안(참고용)을 색·테두리·이름표로 확실히 구분해, AI 추론이 사실처럼 보이지 않게 한다.
// 상호작용은 기본 <details> 요소와 CSS만 쓰므로 서버·클라이언트 어디서든 쓸 수 있다.
import type { CSSProperties, ReactNode } from "react";
import { CATEGORY_EMOJI } from "@/lib/categories";
import { formatKst } from "@/lib/format";
import type { Importance, Issue, SummaryEvidence } from "@/lib/types";

/** 중요도는 색 + 아이콘 + 글자를 함께 써서 색을 구분하기 어려워도 알아볼 수 있게 한다. */
const IMPORTANCE_STYLE: Record<Importance, { text: string; icon: string; badge: string; edge: string }> = {
  high: { text: "높음", icon: "🔥", badge: "bg-coral-100 text-coral-700", edge: "border-l-coral-300" },
  medium: { text: "보통", icon: "⭐", badge: "bg-butter-100 text-butter-700", edge: "border-l-butter-300" },
  low: { text: "낮음", icon: "🌱", badge: "bg-mint-50 text-mint-700", edge: "border-l-mint-300" },
};

/** 기본으로 보여줄 기사 내용 줄 수 (나머지는 '상세 분석 보기' 안) */
const VISIBLE_POINTS = 3;

/** 영역 이름표: 기사 사실인지, AI 분석·제안인지 한눈에 알게 한다 (PRD 5장 "AI 분석" 표시) */
function SectionLabel({ icon, children, tag, tagClass }: { icon: string; children: ReactNode; tag?: string; tagClass?: string }) {
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-bold">
      <span aria-hidden="true">{icon}</span>
      {children}
      {tag && <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tagClass}`}>{tag}</span>}
    </p>
  );
}

/** 요약 한 줄 + 코드 점검 결과(근거 기사 번호, 원문에서 찾지 못한 수치) */
interface FactPoint {
  text: string;
  evidence?: SummaryEvidence;
}

function FactList({ points, showSourceNumbers }: { points: FactPoint[]; showSourceNumbers: boolean }) {
  return (
    <ul className="space-y-1 text-[15.5px] leading-[1.7] text-ink">
      {points.map(({ text, evidence }) => (
        <li key={text} className="flex gap-2">
          <span aria-hidden="true" className="mt-[11px] h-1.5 w-1.5 shrink-0 rounded-full bg-mint-600" />
          <span>
            {text}
            {/* 근거 기사 번호: 아래 '근거 기사' 목록의 번호와 같다 */}
            {showSourceNumbers && evidence?.source !== null && evidence?.source !== undefined && (
              <sup className="ml-0.5 text-[11px] font-semibold text-mint-700">
                <span className="sr-only">근거 기사 </span>[{evidence.source + 1}]
              </sup>
            )}
            {evidence && evidence.unverifiedNumbers.length > 0 && (
              <span
                className="ml-1.5 inline-block rounded-full bg-butter-100 px-2 py-px align-middle text-[11px] font-semibold text-butter-700"
                title={`원문에서 같은 값을 찾지 못함: ${evidence.unverifiedNumbers.join(", ")}`}
              >
                수치 확인 필요
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function IssueCard({ issue, style }: { issue: Issue; style?: CSSProperties }) {
  const importance = IMPORTANCE_STYLE[issue.importance];
  // 예전 형식(한 문장)으로 저장된 결과도 깨지지 않게 목록으로 맞춘다
  const points: FactPoint[] = ([] as string[])
    .concat(issue.summary)
    .map((text, index) => ({ text, evidence: issue.summaryEvidence?.[index] }));
  const morePoints = points.slice(VISIBLE_POINTS);
  // 보조 기사가 있을 때만 줄마다 근거 번호를 단다 (대표 1개뿐이면 번호가 의미 없음)
  const sources = issue.sources ?? [];
  const showSourceNumbers = sources.length > 1;

  return (
    <article
      style={style}
      className={`flex animate-rise flex-col gap-2.5 rounded-3xl border-l-4 bg-cream p-4 shadow-soft transition duration-200 hover:-translate-y-0.5 hover:shadow-lift sm:p-5 ${importance.edge}`}
    >
      {/* 3. 중요도 · 4. 분야 · 9. 원문 링크(새 탭) — 한 줄 */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
          <span className={`rounded-full px-2.5 py-0.5 font-bold ${importance.badge}`}>
            {importance.icon} {importance.text}
          </span>
          {issue.categories.map((category) => (
            <span key={category} className="text-ink-soft">
              {CATEGORY_EMOJI[category]} {category}
            </span>
          ))}
        </div>
        <a
          href={issue.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-full bg-mint-100 px-3 py-1 text-[13px] font-semibold text-mint-700 transition-colors hover:bg-mint-300 hover:text-ink"
        >
          원문 보기 ↗
        </a>
      </div>

      {/* 1. 제목 · 2. 출처·날짜 */}
      <div>
        <h2 className="text-[17px] font-bold leading-snug text-ink">{issue.title}</h2>
        <p className="mt-0.5 text-[13px] text-ink-soft">
          {issue.sourceName} · <time dateTime={issue.publishedAt}>{formatKst(issue.publishedAt)}</time>
        </p>
      </div>

      {/* 5. 핵심내용 — 기사에 있는 사실, 앞 3줄 */}
      <section aria-label="기사 내용" className="space-y-1">
        <SectionLabel icon="📄">
          <span className="text-ink-soft">기사 내용</span>
        </SectionLabel>
        <FactList points={points.slice(0, VISIBLE_POINTS)} showSourceNumbers={showSourceNumbers} />
      </section>

      {/* 6. 중기부 연관성 — AI의 추정 (라벤더 영역) */}
      <section aria-label="AI 분석" className="rounded-2xl bg-lavender-50 px-3.5 py-3 ring-1 ring-lavender-100">
        <SectionLabel icon="🔍" tag="AI 분석 · 추정" tagClass="bg-lavender-600 text-white">
          <span className="text-lavender-700">중기부 연관성</span>
        </SectionLabel>
        <p className="mt-1 text-[14.5px] leading-[1.7] text-ink">{issue.relevance}</p>
      </section>

      {/* 펼치기: 나머지 기사 내용 · 중요도 근거 · 7. 업무 활용 아이디어 · 8. 추가 확인사항 */}
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-xl px-1 py-1.5 text-sm font-semibold text-lavender-700 hover:text-ink [&::-webkit-details-marker]:hidden">
          <span aria-hidden="true" className="transition-transform duration-200 group-open:rotate-90">
            ▸
          </span>
          <span className="group-open:hidden">상세 분석 보기</span>
          <span className="hidden group-open:inline">상세 분석 접기</span>
        </summary>
        <div className="space-y-3 pt-2">
          {morePoints.length > 0 && <FactList points={morePoints} showSourceNumbers={showSourceNumbers} />}

          {/* 근거 기사: AI가 요약할 때 실제로 읽은 기사들 (0번 = 대표 원문). 사실 확인은 원문에서 한다. */}
          {showSourceNumbers && (
            <div className="rounded-2xl bg-mint-50 px-3.5 py-3">
              <SectionLabel icon="🔗">
                <span className="text-mint-700">근거 기사</span>
              </SectionLabel>
              <ol className="mt-1 space-y-0.5 text-[13.5px] leading-[1.7]">
                {sources.map((source, index) => (
                  <li key={source.url} className="flex gap-1.5">
                    <span className="shrink-0 font-semibold text-mint-700">[{index + 1}]</span>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-ink underline decoration-mint-300 underline-offset-2 hover:decoration-mint-700"
                    >
                      {source.publisher}
                      {index === 0 && " (대표)"} · {formatKst(source.publishedAt)} ↗
                    </a>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {issue.importanceReason && (
            <div className="rounded-2xl bg-lavender-50 px-3.5 py-3 ring-1 ring-lavender-100">
              <SectionLabel icon="🎯" tag="AI 판단" tagClass="bg-lavender-600 text-white">
                <span className="text-lavender-700">중요도 {importance.text}인 이유</span>
              </SectionLabel>
              <p className="mt-1 text-[14.5px] leading-[1.7] text-ink">{issue.importanceReason}</p>
            </div>
          )}
          {/* 판단 근거가 비어 있던 이슈: 이슈는 남기고 경고만 표시한다 */}
          {issue.importanceReasonMissing && !issue.importanceReason && (
            <div className="rounded-2xl bg-butter-100 px-3.5 py-3">
              <SectionLabel icon="⚠️">
                <span className="text-butter-700">중요도 {importance.text} — 판단 근거 없음</span>
              </SectionLabel>
              <p className="mt-1 text-[14.5px] leading-[1.7] text-ink">
                AI가 판단 근거를 제시하지 않았습니다. 중요도는 원문을 보고 확인해 주세요.
              </p>
            </div>
          )}

          {/* AI 제안은 점선 테두리로 '참고용'임을 드러낸다 */}
          <div className="rounded-2xl border-2 border-dashed border-butter-300 bg-cream px-3.5 py-3">
            <SectionLabel icon="💡" tag="AI 제안 · 참고용" tagClass="bg-butter-100 text-butter-700">
              <span className="text-butter-700">업무 활용 아이디어</span>
            </SectionLabel>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-[14.5px] leading-[1.7] text-ink">
              {issue.ideas.map((idea) => (
                <li key={idea}>{idea}</li>
              ))}
            </ul>
          </div>

          {/* 추가 확인사항이 없으면 칸 자체를 숨긴다 */}
          {issue.followUp && (
            <div className="rounded-2xl bg-mint-50 px-3.5 py-3">
              <SectionLabel icon="🔎">
                <span className="text-mint-700">추가 확인 필요</span>
              </SectionLabel>
              <p className="mt-1 text-[14.5px] leading-[1.7] text-ink">{issue.followUp}</p>
            </div>
          )}
        </div>
      </details>
    </article>
  );
}
