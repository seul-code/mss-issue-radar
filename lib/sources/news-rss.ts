// Design Ref: §2 입력 ⓒ — 언론사 RSS 수집기 (무료, 키 없음). AI 웹 검색을 대신한다.
// AI 웹 검색은 정부 누리집이나 몇 년 전 기사만 찾아 최신 언론 기사가 0건이었다 (2026-10-12 실제 점검).
// 화면에는 제목·원문 링크만 쓰고, 요약은 AI 판단에만 쓴다 (PRD 7장 저작권).
import { EXCERPT_MAX } from "@/lib/sources/preprocess";
import { readTag, toPlainText } from "@/lib/sources/xml";
import type { RawItem } from "@/lib/types";

/** 수집할 언론사 RSS: 중기부 관심 분야와 겹치는 경제·산업 분야만 */
export const NEWS_FEEDS = [
  { publisher: "연합뉴스", url: "https://www.yna.co.kr/rss/economy.xml" },
  { publisher: "연합뉴스", url: "https://www.yna.co.kr/rss/industry.xml" },
  { publisher: "뉴시스", url: "https://www.newsis.com/RSS/economy.xml" },
  { publisher: "뉴시스", url: "https://www.newsis.com/RSS/industry.xml" },
] as const;

const TIMEOUT_MS = 15_000;

/** RSS 표준 날짜("Mon, 12 Oct 2026 07:17:00 +0900")를 UTC ISO 문자열로 바꾼다. 쉼표 뒤 공백이 없어도 읽는다. */
export function rfc822ToIso(text: string): string | undefined {
  const date = new Date(text.replace(/,(?=\S)/, ", "));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** 언론사 RSS 문서를 기사 목록으로 바꾼다. 제목·원문 주소·날짜가 없는 항목은 버린다. */
export function parseNewsRss(xml: string, publisher: string): RawItem[] {
  const items: RawItem[] = [];
  for (const [, block] of xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/g)) {
    const title = readTag(block, "title");
    const url = readTag(block, "link")?.replace(/&amp;/g, "&");
    const stamp = readTag(block, "pubDate");
    const publishedAt = stamp ? rfc822ToIso(stamp) : undefined;
    if (!title || !url || !/^https?:\/\//.test(url) || !publishedAt) continue;

    // 본문 앞부분에 붙는 "(서울=연합뉴스) 홍길동 기자 =" 같은 기자 이름은 AI에 보내지 않는다 (PRD 7장 개인정보).
    const excerpt = toPlainText(readTag(block, "description") ?? "")
      .replace(/^[[(][^\])]{0,30}[\])]\s*[^=]{0,40}?기자\s*=\s*/, "")
      .slice(0, EXCERPT_MAX);

    items.push({
      source: "news-rss",
      title: toPlainText(title),
      url,
      publisher,
      publishedAt,
      excerpt: excerpt || undefined,
    });
  }
  return items;
}

/**
 * 언론사 RSS를 모두 받는다. 한 곳이 실패해도 나머지는 쓰고, 실패 이유만 돌려준다.
 * 모두 실패하면 오류를 던진다 (호출한 쪽이 출처 오류로 기록하고 계속 진행).
 */
export async function fetchNewsRss(): Promise<{ items: RawItem[]; errors: string[] }> {
  const results = await Promise.allSettled(
    NEWS_FEEDS.map(async (feed) => {
      const res = await fetch(feed.url, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseNewsRss(await res.text(), feed.publisher);
    }),
  );

  const items: RawItem[] = [];
  const errors: string[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") items.push(...result.value);
    else errors.push(`${NEWS_FEEDS[index].url}: ${result.reason instanceof Error ? result.reason.message : "실패"}`);
  });
  if (items.length === 0 && errors.length === NEWS_FEEDS.length) {
    throw new Error(`언론사 RSS 모두 실패 — ${errors.join(" / ")}`);
  }
  return { items, errors };
}
