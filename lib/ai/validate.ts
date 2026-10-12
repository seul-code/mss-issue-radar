// Design Ref: §2 처리 2·4, §6 — AI 응답 검증 (코드, 비용 0). AI가 준 답을 그대로 믿지 않고 규칙대로 거른다.
// CLAUDE.md 6장: AI 응답은 화면·다음 단계에 쓰기 전에 코드로 형식과 개수를 검증한다.
import { buildDetail, checkSummary, toSourceRef } from "@/lib/ai/evidence";
import { NO_EVIDENCE_TEXT, type AnalysisResponse, type ScreeningResponse } from "@/lib/ai/prompts";
import { CATEGORIES } from "@/lib/categories";
import { isGovernment } from "@/lib/sources/preprocess";
import { EMAIL_PATTERN, PHONE_PATTERN } from "@/lib/sources/xml";
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
 * 같은 사건으로 묶인 기사들의 본문을 대표 기사 본문 뒤에 이어 붙인다 (Design §2 처리 3, 세부 요약용).
 * 대표 본문이 짧아도(예: 연합뉴스 한 문장) 다른 언론사 본문으로 보충된다. 전체는 DETAIL_MAX 자까지.
 * 실제로 들어간 기사는 evidence에 남겨, 화면의 근거 기사 링크와 요약 점검에 쓴다.
 */
function mergeDetails(representative: RawItem, members: RawItem[]): Pick<RawItem, "detail" | "evidence"> {
  return buildDetail(
    [representative, ...members.filter((m) => m !== representative)].map((m) => ({
      ref: toSourceRef(m),
      text: m.detail ?? m.excerpt ?? "",
    })),
  );
}

/**
 * 대표 자료에 원문 본문(중기부 보도자료)을 앞에 붙이고, AI에 실제로 들어갈 본문·근거 목록을 다시 만든다.
 * 본문이 길어 다른 기사가 1,500자 밖으로 밀리면 그 기사는 근거 목록에서도 빠진다.
 */
export function withRepresentativeBody(item: RawItem, body: string): RawItem {
  const evidence = item.evidence ?? [{ ref: toSourceRef(item), text: item.detail ?? item.excerpt ?? "" }];
  const [representative, ...others] = evidence;
  const text = representative.text ? `${body} ${representative.text}` : body;
  return { ...item, ...buildDetail([{ ref: representative.ref, text }, ...others]) };
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

    const members = ids.map((id) => items[id]);
    const representative = members.reduce((best, item) => {
      if (isGovernment(best) !== isGovernment(item)) return isGovernment(best) ? best : item;
      return Date.parse(item.publishedAt) < Date.parse(best.publishedAt) ? item : best;
    });
    picked.push({ item: { ...representative, ...mergeDetails(representative, members) }, direct: group.direct === true });
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
/** 세부 요약은 항목형 최대 5줄, 한 줄이 너무 길면 자른다 (화면 가독성) */
const MAX_SUMMARY_POINTS = 5;
const MAX_POINT_LENGTH = 160;

const VALID_CATEGORIES = new Set<string>(CATEGORIES);
const VALID_IMPORTANCE = new Set<string>(["high", "medium", "low"]);

/**
 * 일반인 연락처가 AI 문장에 섞여 들어오면 지운다 (PRD 7장). 전화번호·이메일 형태만 대상으로 한다.
 * 이름은 공인·기관명과 구분할 수 없어 지시문으로만 막는다.
 */
function scrubContacts(text: string): string {
  // 수집 단계(lib/sources/xml.ts stripContacts)와 같은 규칙을 쓴다.
  return text.replace(PHONE_PATTERN, "[연락처 삭제]").replace(EMAIL_PATTERN, "[연락처 삭제]");
}

/** 앞뒤 공백을 정리하고 연락처를 지운 문장. 비어 있으면 undefined. */
function clean(text: unknown): string | undefined {
  if (typeof text !== "string") return undefined;
  const trimmed = scrubContacts(text.replace(/\s+/g, " ").trim());
  return trimmed || undefined;
}

/** 세부 요약 줄 정리: 앞의 "•", "-", "1." 같은 기호를 떼고, 같은 줄은 하나만, 최대 5줄 */
function cleanPoints(points: unknown): string[] {
  if (!Array.isArray(points)) return [];
  const lines = points
    .map((p) => clean(p)?.replace(/^([•·\-*]|\d+[.)])\s*/, ""))
    .filter((p): p is string => !!p)
    .map((p) => (p.length > MAX_POINT_LENGTH ? `${p.slice(0, MAX_POINT_LENGTH - 1)}…` : p));
  return [...new Set(lines)].slice(0, MAX_SUMMARY_POINTS);
}

/** 근거 기사 목록에 보여줄 보조 기사 최대 수 (대표 1개 + 보조 4개) */
const MAX_SUPPORTING_SOURCES = 4;
/** 중요도 판단 근거가 이보다 짧으면 근거가 없는 것으로 본다 */
const MIN_REASON_LENGTH = 10;

export interface AnalysisResult {
  /** 화면에 보여줄 이슈 (최대 20건) */
  issues: Issue[];
  /** 규칙에 맞지 않아 버린 답의 수 (기록용) */
  dropped: number;
  /** 이슈는 남겼지만 경고를 붙인 수 (기록용) */
  warnings: { missingReason: number; unverifiedNumberLines: number };
}

/**
 * 최종 분석 응답을 화면용 이슈 카드로 바꾼다 (Design §2 처리 4).
 * - 제목·날짜·출처·원문 주소는 AI 답이 아니라 후보 자료에서 가져온다
 * - 없는 번호·중복 번호, 분야가 하나도 맞지 않는 답, 중요도·핵심내용·아이디어가 없는 답은 버린다
 * - 분야는 10개 안의 이름만 최대 2개, 아이디어 최대 2개, 확인사항 최대 1개, 세부 요약 최대 5줄
 * - 연관성이 비어 있으면 "직접 연관된 정책은 확인 필요"로 채운다
 * - 중요도 판단 근거가 비었거나 너무 짧으면 이슈는 남기고 경고 표시(importanceReasonMissing)를 붙인다
 * - 근거 기사 목록(sources)과 요약 줄 점검 결과(summaryEvidence)를 코드로 붙인다 (사실 검증 보장 아님)
 */
export function analysisToIssues(candidates: RawItem[], response: AnalysisResponse): AnalysisResult {
  const used = new Set<number>();
  const issues: Issue[] = [];
  const warnings = { missingReason: 0, unverifiedNumberLines: 0 };
  const answers = Array.isArray(response?.issues) ? response.issues : [];

  for (const answer of answers) {
    const id = answer?.id;
    if (!Number.isInteger(id) || id < 0 || id >= candidates.length || used.has(id)) continue;

    const categories = [...new Set((answer.categories ?? []).filter((c) => VALID_CATEGORIES.has(c)))].slice(
      0,
      MAX_CATEGORIES,
    ) as Category[];
    const importance = VALID_IMPORTANCE.has(answer.importance) ? (answer.importance as Importance) : undefined;
    const summary = cleanPoints(answer.summary);
    const ideas = [...new Set((answer.ideas ?? []).map(clean).filter((idea): idea is string => !!idea))].slice(
      0,
      MAX_IDEAS,
    );
    if (categories.length === 0 || !importance || summary.length === 0 || ideas.length === 0) continue;

    used.add(id);
    const source = candidates[id];
    const reason = clean(answer.importanceReason);
    const reasonMissing = !reason || reason.length < MIN_REASON_LENGTH;
    // 근거 기사: 대표 + AI가 실제로 읽은 보조 기사 (최대 4개). 요약 점검은 잘리기 전 전체 목록으로 하고, 번호가 잘린 범위를 넘으면 표시하지 않는다.
    const evidence = source.evidence ?? [{ ref: toSourceRef(source), text: source.detail ?? source.excerpt ?? "" }];
    const sources = evidence.slice(0, 1 + MAX_SUPPORTING_SOURCES).map((e) => e.ref);
    const summaryEvidence = checkSummary(summary, source, evidence).map((e) => ({
      ...e,
      source: e.source !== null && e.source < sources.length ? e.source : null,
    }));

    if (reasonMissing) warnings.missingReason += 1;
    warnings.unverifiedNumberLines += summaryEvidence.filter((e) => e.unverifiedNumbers.length > 0).length;

    issues.push({
      id: source.url,
      title: source.title,
      publishedAt: source.publishedAt,
      sourceName: source.publisher,
      importance,
      importanceReason: reasonMissing ? undefined : reason,
      importanceReasonMissing: reasonMissing || undefined,
      categories,
      summary,
      relevance: clean(answer.relevance) ?? NO_EVIDENCE_TEXT,
      ideas,
      followUp: clean(answer.followUp),
      sourceUrl: source.url,
      sources,
      summaryEvidence,
    });
  }

  const kept = issues.slice(0, MAX_ISSUES);
  return { issues: kept, dropped: answers.length - kept.length, warnings };
}
