// Design Ref: §2 입력 ⓑ — 정책브리핑 정책뉴스 API 수집기 (공공데이터포털, 무료, 인증키 필요).
// 전 부처 정책뉴스가 오므로 관련 기사 고르기는 전처리(키워드)와 AI 1차 선별이 한다.
// 이 파일은 서버에서만 쓴다. 인증키는 .env의 DATA_GO_KR_API_KEY에서 읽고 오류 메시지·로그에 남기지 않는다.
import { EXCERPT_MAX } from "@/lib/sources/preprocess";
import { decodeEntities, kstToIso, readTag, toPlainText } from "@/lib/sources/xml";
import type { RawItem } from "@/lib/types";

export const POLICY_NEWS_URL = "https://apis.data.go.kr/1371000/policyNewsService2/policyNewsList2";
const TIMEOUT_MS = 20_000;

/** 승인 시각("10/08/2026 17:10:00", 한국 시각)을 UTC ISO 문자열로 바꾼다 (Design §2.1). */
export function approveDateToIso(text: string): string | undefined {
  const m = text.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return undefined;
  const [, mo, d, y, h, mi, s] = m;
  return kstToIso(y, mo, d, h, mi, s);
}

/**
 * API 응답(XML)을 기사 목록으로 바꾼다.
 * - 원문 주소·제목·날짜가 없는 기사는 버린다
 * - 본문은 부제목+본문 앞부분을 순수 글자로 바꿔 300자만 남긴다 (저장·표시하지 않고 AI 판단에만 씀, Design §6)
 */
export function parsePolicyNews(xml: string): RawItem[] {
  const code = readTag(xml, "resultCode");
  if (code === undefined || code !== "0") {
    // 인증 실패 등은 OpenAPI_ServiceResponse 형식으로 온다. 키 값은 메시지에 담지 않는다.
    const reason = readTag(xml, "returnAuthMsg") ?? readTag(xml, "resultMsg") ?? "알 수 없는 응답";
    throw new Error(`정책뉴스 API 오류: ${reason}`);
  }

  const items: RawItem[] = [];
  for (const [, block] of xml.matchAll(/<NewsItem>([\s\S]*?)<\/NewsItem>/g)) {
    const title = readTag(block, "Title");
    const url = readTag(block, "OriginalUrl");
    const stamp = readTag(block, "ApproveDate");
    const publishedAt = stamp ? approveDateToIso(stamp) : undefined;
    if (!title || !url || !/^https?:\/\//.test(url) || !publishedAt) continue;

    const excerpt = toPlainText(`${readTag(block, "SubTitle1") ?? ""} ${readTag(block, "DataContents") ?? ""}`);
    items.push({
      source: "policy-news",
      title: toPlainText(title),
      url: decodeEntities(url),
      publisher: readTag(block, "MinisterCode") ?? "정책브리핑",
      publishedAt,
      excerpt: excerpt ? excerpt.slice(0, EXCERPT_MAX) : undefined,
    });
  }
  return items;
}

/** 한국 날짜 "YYYYMMDD" */
function kstDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(date)
    .replace(/-/g, "");
}

/**
 * 정책뉴스를 받아 기사 목록으로 돌려준다. 48시간 확장에도 쓸 수 있게 이틀 전 날짜부터 요청하고,
 * 정확한 기간 거르기는 전처리가 한다. 실패하면 오류를 던지고, 다른 출처 진행 여부는 호출한 쪽이 정한다.
 */
export async function fetchPolicyNews(now: Date): Promise<RawItem[]> {
  const key = process.env.DATA_GO_KR_API_KEY;
  if (!key) throw new Error("DATA_GO_KR_API_KEY 환경변수가 없습니다");

  const params = new URLSearchParams({
    serviceKey: key, // 디코딩 키를 넣으면 URLSearchParams가 알맞게 인코딩한다.
    startDate: kstDate(new Date(now.getTime() - 48 * 3600_000)),
    endDate: kstDate(now),
  });

  let res: Response;
  try {
    res = await fetch(`${POLICY_NEWS_URL}?${params}`, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    // 네트워크 오류 메시지에 요청 주소(키 포함)가 섞이지 않도록 이유만 남긴다.
    throw new Error(`정책뉴스 API 연결 실패: ${error instanceof Error ? error.name : "알 수 없음"}`);
  }
  const text = await res.text();
  if (!res.ok && !text.includes("<returnAuthMsg>")) throw new Error(`정책뉴스 API 응답 오류: HTTP ${res.status}`);
  return parsePolicyNews(text);
}
