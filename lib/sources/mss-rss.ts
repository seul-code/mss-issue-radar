// Design Ref: §2 입력 ⓐ — 중기부 보도자료 RSS 수집기 (무료, 키 없음).
// RSS 구조가 단순해 별도 라이브러리 없이 정규식으로 읽는다 (Design §3 "쓰지 않는 것").
import { timeoutSignal } from "@/lib/abort";
import { kstToIso, readTag } from "@/lib/sources/xml";
import type { RawItem } from "@/lib/types";

export const MSS_RSS_URL = "https://www.mss.go.kr/rss/smba/board/86.do";
const PUBLISHER = "중소벤처기업부";
const TIMEOUT_MS = 15_000;

/**
 * 중기부 RSS 날짜(한국 시각 "20261006091605")를 UTC ISO 문자열로 바꾼다.
 * Design §2.1 시간 기준: 저장은 UTC, 화면에서만 한국 시각.
 */
export function kstStampToIso(stamp: string): string | undefined {
  const m = stamp.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s] = m;
  return kstToIso(y, mo, d, h, mi, s);
}

/** RSS 문서(XML 문자열)를 기사 목록으로 바꾼다. 원문 주소나 날짜가 없는 항목은 버린다. */
export function parseMssRss(xml: string): RawItem[] {
  const items: RawItem[] = [];
  for (const [, block] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const title = readTag(block, "title");
    const url = readTag(block, "link")?.replace(/&amp;/g, "&");
    const stamp = readTag(block, "pubDate");
    const publishedAt = stamp ? kstStampToIso(stamp) : undefined;

    // PRD 5장: 원문 URL이 없는 자료는 이슈로 만들지 않는다.
    if (!title || !url || !/^https?:\/\//.test(url) || !publishedAt) continue;

    items.push({ source: "mss-rss", title, url, publisher: PUBLISHER, publishedAt });
  }
  return items;
}

/** 중기부 RSS를 받아 기사 목록으로 돌려준다. 실패하면 오류를 던지고, 다른 출처 진행 여부는 호출한 쪽이 정한다. */
export async function fetchMssRss(signal?: AbortSignal): Promise<RawItem[]> {
  const res = await fetch(MSS_RSS_URL, {
    cache: "no-store", // 하루 1회 실행마다 최신 RSS를 받는다.
    signal: timeoutSignal(TIMEOUT_MS, signal),
  });
  if (!res.ok) throw new Error(`중기부 RSS 응답 오류: HTTP ${res.status}`);
  return parseMssRss(await res.text());
}
