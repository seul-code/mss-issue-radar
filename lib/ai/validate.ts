// Design Ref: §2 처리 2·4, §6 — AI 응답 검증 (코드, 비용 0). AI가 준 답을 그대로 믿지 않고 규칙대로 거른다.
// CLAUDE.md 6장: AI 응답은 화면·다음 단계에 쓰기 전에 코드로 형식과 개수를 검증한다.
import { NO_EVIDENCE_TEXT, type AnalysisResponse, type ScreeningResponse } from "@/lib/ai/prompts";
import { CATEGORIES } from "@/lib/categories";
import { isGovernment } from "@/lib/sources/preprocess";
import type { Category, Importance, Issue, RawItem } from "@/lib/types";

/** PRD 5장: 하루 이슈는 최대 20개 */
export const MAX_ISSUES = 20;

export interface ScreeningResult {
  /** 2단계 분석으로 보낼 대표 자료 (최대 20건) */
  candidates: RawItem[];
  /** 자르기 전 관련 사건 수. 5건 미만이면 48시간으로 넓힌다 (PRD 5장) */
  relevantCount: number;
}

/**
 * 1차 선별 응답으로 대표 자료를 고른다 (Design §2 처리 2).
 * - 없는 번호·중복 번호는 무시한다 (먼저 나온 묶음이 가진다)
 * - 묶음의 대표: 정부 자료 우선, 없으면 가장 먼저 보도한 곳
 * - 20건을 넘으면 중기부 직접 관련 → 정부 자료 → 최신순으로 자른다
 */
export function pickCandidates(items: RawItem[], response: ScreeningResponse): ScreeningResult {
  const used = new Set<number>();
  const picked: { item: RawItem; direct: boolean }[] = [];

  for (const group of response.groups ?? []) {
    const ids = (group.ids ?? []).filter(
      (id) => Number.isInteger(id) && id >= 0 && id < items.length && !used.has(id),
    );
    if (ids.length === 0) continue;
    ids.forEach((id) => used.add(id));

    const representative = ids
      .map((id) => items[id])
      .reduce((best, item) => {
        if (isGovernment(best) !== isGovernment(item)) return isGovernment(best) ? best : item;
        return Date.parse(item.publishedAt) < Date.parse(best.publishedAt) ? item : best;
      });
    picked.push({ item: representative, direct: group.direct === true });
  }

  const ordered = picked.sort(
    (a, b) =>
      Number(b.direct) - Number(a.direct) ||
      Number(isGovernment(b.item)) - Number(isGovernment(a.item)) ||
      Date.parse(b.item.publishedAt) - Date.parse(a.item.publishedAt),
  );

  return { candidates: ordered.slice(0, MAX_ISSUES).map((p) => p.item), relevantCount: picked.length };
}

// ─────────────────────────────── 최종 분석 검증 ───────────────────────────────

/** PRD 5장 개수 제한 */
const MAX_CATEGORIES = 2;
const MAX_IDEAS = 2;
const MAX_SUMMARY_SENTENCES = 2;

const VALID_CATEGORIES = new Set<string>(CATEGORIES);
const VALID_IMPORTANCE = new Set<string>(["high", "medium", "low"]);

/**
 * 일반인 연락처가 AI 문장에 섞여 들어오면 지운다 (PRD 7장). 전화번호·이메일 형태만 대상으로 한다.
 * 이름은 공인·기관명과 구분할 수 없어 지시문으로만 막는다.
 */
function scrubContacts(text: string): string {
  return text
    .replace(/\b0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}\b/g, "[연락처 삭제]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[연락처 삭제]");
}

/** 앞뒤 공백을 정리하고 연락처를 지운 문장. 비어 있으면 undefined. */
function clean(text: unknown): string | undefined {
  if (typeof text !== "string") return undefined;
  const trimmed = scrubContacts(text.replace(/\s+/g, " ").trim());
  return trimmed || undefined;
}

/** 핵심내용은 2문장까지만 남긴다 (PRD 5장). "3.5%"처럼 숫자 속 마침표는 문장 끝으로 보지 않는다. */
function limitSentences(text: string, max: number): string {
  return text.split(/(?<=[.!?。]["'”’)]?)\s+/).slice(0, max).join(" ");
}

export interface AnalysisResult {
  /** 화면에 보여줄 이슈 (최대 20건) */
  issues: Issue[];
  /** 규칙에 맞지 않아 버린 답의 수 (기록용) */
  dropped: number;
}

/**
 * 최종 분석 응답을 화면용 이슈 카드로 바꾼다 (Design §2 처리 4).
 * - 제목·날짜·출처·원문 주소는 AI 답이 아니라 후보 자료에서 가져온다
 * - 없는 번호·중복 번호, 분야가 하나도 맞지 않는 답, 중요도·핵심내용·아이디어가 없는 답은 버린다
 * - 분야는 10개 안의 이름만 최대 2개, 아이디어 최대 2개, 확인사항 최대 1개, 핵심내용 최대 2문장
 * - 연관성이 비어 있으면 "직접 연관된 정책은 확인 필요"로 채운다
 */
export function analysisToIssues(candidates: RawItem[], response: AnalysisResponse): AnalysisResult {
  const used = new Set<number>();
  const issues: Issue[] = [];
  const answers = Array.isArray(response?.issues) ? response.issues : [];

  for (const answer of answers) {
    const id = answer?.id;
    if (!Number.isInteger(id) || id < 0 || id >= candidates.length || used.has(id)) continue;

    const categories = [...new Set((answer.categories ?? []).filter((c) => VALID_CATEGORIES.has(c)))].slice(
      0,
      MAX_CATEGORIES,
    ) as Category[];
    const importance = VALID_IMPORTANCE.has(answer.importance) ? (answer.importance as Importance) : undefined;
    const summary = clean(answer.summary);
    const ideas = [...new Set((answer.ideas ?? []).map(clean).filter((idea): idea is string => !!idea))].slice(
      0,
      MAX_IDEAS,
    );
    if (categories.length === 0 || !importance || !summary || ideas.length === 0) continue;

    used.add(id);
    const source = candidates[id];
    issues.push({
      id: source.url,
      title: source.title,
      publishedAt: source.publishedAt,
      sourceName: source.publisher,
      importance,
      categories,
      summary: limitSentences(summary, MAX_SUMMARY_SENTENCES),
      relevance: clean(answer.relevance) ?? NO_EVIDENCE_TEXT,
      ideas,
      followUp: clean(answer.followUp),
      sourceUrl: source.url,
    });
  }

  const kept = issues.slice(0, MAX_ISSUES);
  return { issues: kept, dropped: answers.length - kept.length };
}
