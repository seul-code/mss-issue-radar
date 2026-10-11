// Design Ref: §2 입력 ⓒ — 언론사 RSS 수집기 (무료, 키 없음). AI 웹 검색을 대신한다.
// AI 웹 검색은 정부 누리집이나 몇 년 전 기사만 찾아 최신 언론 기사가 0건이었다 (2026-10-12 실제 점검).
// 화면에는 제목·원문 링크만 쓰고, 요약은 AI 판단에만 쓴다 (PRD 7장 저작권).
import { EXCERPT_MAX } from "@/lib/sources/preprocess";
import { readTag, toPlainText } from "@/lib/sources/xml";
import type { RawItem } from "@/lib/types";

/**
 * 수집할 언론사 RSS: 중기부 관심 분야와 겹치는 경제·산업 분야만 (2026-10-12 확인).
 * 날짜가 없거나(한겨레) RSS가 없거나 막힌 곳(중앙일보·한국일보·매일경제·KBS·MBC·YTN·뉴스1)은 넣지 않았다.
 * 요약이 없는 곳(한국경제·서울경제·아시아경제)은 제목만으로 AI가 판단한다.
 */
export const NEWS_FEEDS = [
  // 통신사
  { publisher: "연합뉴스", url: "https://www.yna.co.kr/rss/economy.xml" },
  { publisher: "연합뉴스", url: "https://www.yna.co.kr/rss/industry.xml" },
  { publisher: "뉴시스", url: "https://www.newsis.com/RSS/economy.xml" },
  { publisher: "뉴시스", url: "https://www.newsis.com/RSS/industry.xml" },
  // 종합일간지
  { publisher: "조선일보", url: "https://www.chosun.com/arc/outboundfeeds/rss/category/economy/?outputType=xml" },
  { publisher: "동아일보", url: "https://rss.donga.com/economy.xml" },
  { publisher: "경향신문", url: "https://www.khan.co.kr/rss/rssdata/economy_news.xml" },
  { publisher: "국민일보", url: "https://www.kmib.co.kr/rss/data/kmibEcoRss.xml" },
  { publisher: "세계일보", url: "https://www.segye.com/Articles/RSSList/segye_economy.xml" },
  { publisher: "서울신문", url: "https://www.seoul.co.kr/xml/rss/rss_economy.xml" },
  // 경제·산업 전문지
  { publisher: "한국경제", url: "https://www.hankyung.com/feed/economy" },
  { publisher: "서울경제", url: "https://www.sedaily.com/rss/economy" },
  { publisher: "머니투데이", url: "https://rss.mt.co.kr/mt_news.xml" },
  { publisher: "파이낸셜뉴스", url: "https://www.fnnews.com/rss/r20/fn_realnews_economy.xml" },
  { publisher: "아시아경제", url: "https://www.asiae.co.kr/rss/economy.htm" },
  { publisher: "아주경제", url: "https://www.ajunews.com/rss/economy.xml" },
  { publisher: "전자신문", url: "https://rss.etnews.com/Section901.xml" },
  // 방송
  { publisher: "SBS", url: "https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=02&plink=RSSREADER" },
] as const;

const TIMEOUT_MS = 15_000;

/**
 * RSS 날짜를 UTC ISO 문자열로 바꾼다. 언론사마다 형식이 조금씩 달라 아래를 모두 읽는다.
 * "Mon, 12 Oct 2026 07:17:00 +0900" · "Mon,12 Oct 2026 …"(쉼표 뒤 공백 없음) · "11 Oct  2026 22:03:00 GMT" · "2026-10-12T06:00:11+09:00"
 */
export function rfc822ToIso(text: string): string | undefined {
  const date = new Date(text.replace(/,(?=\S)/, ", ").replace(/\s+/g, " ").trim());
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** 언론사 RSS 문서를 기사 목록으로 바꾼다. 제목·원문 주소·날짜가 없는 항목은 버린다. */
export function parseNewsRss(xml: string, publisher: string): RawItem[] {
  const items: RawItem[] = [];
  for (const [, block] of xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/g)) {
    const title = readTag(block, "title");
    const url = readTag(block, "link")?.replace(/&amp;/g, "&");
    const stamp = readTag(block, "pubDate") ?? readTag(block, "dc:date");
    const publishedAt = stamp ? rfc822ToIso(stamp) : undefined;
    if (!title || !url || !/^https?:\/\//.test(url) || !publishedAt) continue;

    // 본문 앞부분에 붙는 "(서울=연합뉴스) 홍길동 기자 =" 같은 기자 이름은 AI에 보내지 않는다 (PRD 7장 개인정보).
    const excerpt = toPlainText(readTag(block, "description") ?? "")
      .replace(/^[[(][^\])]{0,30}[\])]\s*[^=]{0,40}?기자\s*=\s*/, "")
      // 사진 설명의 "[사진=홍길동 기자 abc@…]"와 이메일 주소도 지운다.
      .replace(/\[사진[^\]]{0,80}\]/g, "")
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "")
      .replace(/\s+/g, " ")
      .trim()
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
