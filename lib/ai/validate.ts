// Design Ref: §2 처리 2·4, §6 — AI 응답 검증 (코드, 비용 0). AI가 준 답을 그대로 믿지 않고 규칙대로 거른다.
// CLAUDE.md 6장: AI 응답은 화면·다음 단계에 쓰기 전에 코드로 형식과 개수를 검증한다.
import type { ScreeningResponse, SearchResponse } from "@/lib/ai/prompts";
import { isGovernment, normalizeUrl } from "@/lib/sources/preprocess";
import type { RawItem } from "@/lib/types";

/** PRD 5장: 하루 이슈는 최대 20개 */
export const MAX_ISSUES = 20;

/**
 * 웹 검색 응답을 기사 목록으로 바꾼다.
 * - 원문 주소가 http(s)가 아니거나, 날짜를 알 수 없으면 버린다 (Design §2.1)
 * - citedUrls가 있으면(실제 호출) 웹 검색이 실제로 본 주소만 남긴다 — 지어낸 링크 차단 (Design §6)
 */
export function searchToRawItems(response: SearchResponse, citedUrls: string[] | null): RawItem[] {
  const cited = citedUrls ? new Set(citedUrls.map(normalizeUrl)) : null;
  const items: RawItem[] = [];

  for (const article of response.articles ?? []) {
    const url = article.url?.trim();
    const time = article.publishedAt ? Date.parse(article.publishedAt) : NaN;
    if (!article.title?.trim() || !url || !/^https?:\/\//.test(url) || Number.isNaN(time)) continue;
    if (cited && !cited.has(normalizeUrl(url))) continue;

    items.push({
      source: "web-search",
      title: article.title.trim(),
      url,
      publisher: article.publisher?.trim() || "언론",
      publishedAt: new Date(time).toISOString(),
      excerpt: article.summary?.trim() || undefined,
    });
  }
  return items;
}

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
