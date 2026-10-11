// Design Ref: §2 처리 1 — 전처리 (코드, 비용 0). AI에 보내기 전에 코드로 할 수 있는 거르기를 모두 끝낸다.
// CLAUDE.md 2장: 기간 필터·URL 확인·중복 제거는 AI에 맡기지 않는다.
import { CATEGORY_KEYWORDS } from "@/lib/categories";
import type { RawItem } from "@/lib/types";

/** AI에 보낼 본문 앞부분 최대 길이 (Design §6: 약 300자만 보내고 저장·표시하지 않음) */
export const EXCERPT_MAX = 300;

const ALL_KEYWORDS = Object.values(CATEGORY_KEYWORDS).flat();

/** 정부 자료인지 (대표 출처를 고를 때 정부 자료를 우선한다 — PRD 5장) */
export function isGovernment(item: RawItem): boolean {
  return item.source === "mss-rss" || item.source === "policy-news";
}

/** 같은 기사인지 비교하기 위한 주소 정리: 앞뒤 공백, #뒤 조각, 끝의 / 를 없애고 도메인은 소문자로 */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    u.hash = "";
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    return url.trim();
  }
}

/** 제목 비교용: 괄호 속 말머리([단독] 등), 공백, 문장부호를 지운다. 거의 같은 제목만 같다고 본다. */
function normalizeTitle(title: string): string {
  return title
    .replace(/[\[(【〈<][^\])】〉>]{1,10}[\])】〉>]/g, "")
    .replace(/[\s\p{P}\p{S}]/gu, "")
    .toLowerCase();
}

/** 둘 중 대표로 남길 자료: 정부 자료 우선, 둘 다 같으면 먼저 보도된 쪽 (PRD 5장) */
function preferred(a: RawItem, b: RawItem): RawItem {
  if (isGovernment(a) !== isGovernment(b)) return isGovernment(a) ? a : b;
  return Date.parse(a.publishedAt) <= Date.parse(b.publishedAt) ? a : b;
}

/** 키워드가 하나라도 들어 있는지 (정책뉴스·언론 기사는 범위가 넓어 먼저 거른다. 중기부 보도자료는 거르지 않음) */
function hasKeyword(item: RawItem): boolean {
  const text = `${item.title} ${item.excerpt ?? ""}`;
  return ALL_KEYWORDS.some((keyword) => text.includes(keyword));
}

export interface PreprocessOptions {
  /** 자동 실행이 시작된 시각. "최근 N시간"은 이 시각부터 거꾸로 센다 (Design §2.1 시간 기준) */
  now: Date;
  /** 수집 기간: 기본 24시간, 관련 이슈가 5건 미만이면 48시간 (PRD 5장) */
  windowHours: 24 | 48;
}

/**
 * 수집한 자료를 AI에 보낼 후보로 정리한다.
 * 1) 원문 주소·날짜가 올바른 것만 → 2) 기간 안의 것만 → 3) 정책뉴스·언론 기사는 키워드 포함만
 * → 4) 같은 주소·같은 제목은 하나로 → 5) 본문 앞부분은 300자로 자름 → 최신순 정렬
 */
export function preprocess(items: RawItem[], { now, windowHours }: PreprocessOptions): RawItem[] {
  const end = now.getTime();
  const start = end - windowHours * 60 * 60 * 1000;

  const candidates = items.filter((item) => {
    const time = Date.parse(item.publishedAt);
    if (!/^https?:\/\//.test(item.url.trim()) || Number.isNaN(time)) return false;
    if (time < start || time > end) return false;
    if (item.source !== "mss-rss" && !hasKeyword(item)) return false;
    return true;
  });

  // 같은 주소 또는 같은 제목이면 대표 하나만 남긴다. 비슷한 사건끼리 묶는 일은 AI 1차 선별이 한다.
  const byUrl = new Map<string, RawItem>();
  const byTitle = new Map<string, RawItem>();
  for (const item of candidates) {
    const urlKey = normalizeUrl(item.url);
    const titleKey = normalizeTitle(item.title);
    const existing = byUrl.get(urlKey) ?? (titleKey ? byTitle.get(titleKey) : undefined);
    const keep = existing ? preferred(existing, item) : item;
    if (existing) {
      byUrl.delete(normalizeUrl(existing.url));
      byTitle.delete(normalizeTitle(existing.title));
    }
    byUrl.set(normalizeUrl(keep.url), keep);
    if (titleKey) byTitle.set(normalizeTitle(keep.title), keep);
  }

  return [...byUrl.values()]
    .map((item) => ({
      ...item,
      url: item.url.trim(),
      excerpt: item.excerpt ? item.excerpt.slice(0, EXCERPT_MAX) : undefined,
    }))
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}
