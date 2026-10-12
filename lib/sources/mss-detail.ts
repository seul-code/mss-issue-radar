// Design Ref: §2 처리 3-1 — 중기부 보도자료 본문 읽기 (PRD 6장: 정부 보도자료만 예외적으로 본문을 읽는다).
// 중기부 RSS에는 본문이 없어 제목만으로는 세부 요약을 쓸 수 없다. 최종 후보로 뽑힌 중기부 자료만 원문 페이지를 읽는다.
// 안전장치: 중기부 보도자료 주소만 허용 · 15초 제한 · 글자만 꺼냄 · 연락처 제거 · 1,500자만 AI에 보냄 · 저장·표시 안 함.
import { timeoutSignal } from "@/lib/abort";
import { DETAIL_MAX } from "@/lib/sources/preprocess";
import { decodeEntities, stripContacts, toPlainText } from "@/lib/sources/xml";

const TIMEOUT_MS = 15_000;

/** 중기부 보도자료 게시판 주소인지 (다른 주소는 절대 열지 않는다) */
export function isMssPressUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "www.mss.go.kr" && u.pathname === "/site/smba/ex/bbs/View.do";
  } catch {
    return false;
  }
}

/**
 * 보도자료 페이지(HTML)에서 본문 글자만 꺼낸다.
 * 본문은 class="view_contents" 부터 표 칸이 끝나는 곳까지이고, 일부는 HTML이 두 번 감싸져 있어 두 번 푼다.
 */
export function extractMssBody(html: string): string | undefined {
  const marker = html.indexOf('class="view_contents"');
  if (marker < 0) return undefined;
  const start = html.indexOf(">", marker) + 1;
  const end = html.indexOf("</td>", start);
  const region = html
    .slice(start, end > start ? end : undefined)
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ");

  // 1차: 바깥 태그 제거 → 글자표기 풀기(안쪽 태그가 드러남) → 2차: 안쪽 태그 제거·글자표기 풀기
  const once = decodeEntities(toPlainText(region));
  const text = stripContacts(toPlainText(once));
  return text ? text.slice(0, DETAIL_MAX) : undefined;
}

/** 보도자료 본문을 읽는다. 허용되지 않은 주소이거나 실패하면 undefined (제목만으로 계속 진행). */
export async function fetchMssDetail(url: string, signal?: AbortSignal): Promise<string | undefined> {
  if (!isMssPressUrl(url)) return undefined;
  try {
    const res = await fetch(url, { cache: "no-store", signal: timeoutSignal(TIMEOUT_MS, signal), redirect: "error" });
    if (!res.ok) return undefined;
    return extractMssBody(await res.text());
  } catch {
    return undefined;
  }
}
