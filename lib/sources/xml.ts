// RSS·API 응답(XML)을 읽는 작은 도구 모음. 구조가 단순해 별도 라이브러리 없이 처리한다 (Design §3).

/** <tag><![CDATA[값]]></tag> 또는 <tag>값</tag> 에서 값을 꺼낸다. */
export function readTag(block: string, tag: string): string | undefined {
  const match = block.match(new RegExp(`<${tag}>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))\\s*</${tag}>`));
  const value = (match?.[1] ?? match?.[2])?.trim();
  return value || undefined;
}

/**
 * 응답이 정상 200이어도 내용이 고장 났는지 확인한다 (Design §5 수집 오류).
 * - 필수 구조(시작·끝 태그)가 없으면 오류: HTML 오류 화면, 중간에 잘린 문서, 형식이 바뀐 문서
 * - 항목은 있는데 하나도 읽지 못했으면 오류: 항목 형식이 바뀐 경우
 * 정상 구조에 항목이 0건인 것은 오류가 아니다 (그날 새 글이 없는 경우).
 */
export function assertFeedStructure(
  xml: string,
  { label, open, close, blocks, parsed }: { label: string; open: RegExp; close: RegExp; blocks: number; parsed: number },
): void {
  if (!open.test(xml) || !close.test(xml)) throw new Error(`${label} 형식 오류: 필수 구조가 없습니다`);
  if (blocks > 0 && parsed === 0) throw new Error(`${label} 형식 오류: 항목 ${blocks}건을 하나도 읽지 못했습니다`);
}

/**
 * 숫자 문자 표기(&#…;)를 글자로 바꾼다. 글자로 쓸 수 없는 값은 빈 문자열로 버린다 — 오류를 던지면 출처 전체가 실패한다.
 * 버리는 값: 범위 밖(0x10FFFF 초과), 짝 없는 대리 문자(D800~DFFF), 탭·줄바꿈을 뺀 제어 문자, 글자가 아닌 FFFE·FFFF
 */
function fromCodePointSafe(code: number): string {
  const invalid =
    !Number.isInteger(code) ||
    code > 0x10ffff ||
    (code >= 0xd800 && code <= 0xdfff) ||
    (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0xfffe ||
    code === 0xffff;
  return invalid ? "" : String.fromCodePoint(code);
}

/** 자주 나오는 HTML 문자 표기를 글자로 바꾼다 (&middot; → · 등) */
export function decodeEntities(text: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·", hellip: "…", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", rarr: "→", larr: "←", uarr: "↑", darr: "↓", sim: "~", bull: "•", times: "×", ndash: "–", mdash: "—" };
  return text
    .replace(/&#(\d+);/g, (_, n: string) => (n.length > 7 ? "" : fromCodePointSafe(Number(n))))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => (n.length > 6 ? "" : fromCodePointSafe(parseInt(n, 16))))
    .replace(/&([a-z]+);/gi, (whole, name) => named[name.toLowerCase()] ?? whole);
}

/** HTML 태그를 지우고 공백을 정리한 순수 글자 */
export function toPlainText(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 전화번호 형태 (수집 단계 stripContacts 와 AI 출력 단계 validate.ts 가 같은 규칙을 쓴다).
 * 010-1234-5678 · 02-123-4567 · 02)1234-5678 · (02)1234-5678 · (031) 123-4567 · 010 1234 5678 · 02.123.4567 · +82-10-1234-5678
 * 날짜(2026-10-12)처럼 0으로 시작하지 않는 숫자, 단어 중간의 숫자는 건드리지 않는다.
 */
export const PHONE_PATTERN = /(?:\+82[-.\s]?\(?0?|\(?\b0)\d{1,2}\)?[-.\s]{0,2}\d{3,4}[-.\s]?\d{4}\b/g;

/** 이메일 형태 (수집·AI 출력 공통) */
export const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

/**
 * 본문 맨 앞의 기자 줄: "(서울=연합뉴스) 홍길동 기자 =", "[서울=…] … 기자 =", "【서울=뉴시스】홍길동 기자 =", "〔세종=…〕 … 기자 ="
 * 맨 앞에서 괄호 + "기자 =" 까지 이어질 때만 지운다 (본문 중간의 괄호나 "기자"라는 낱말은 그대로 둔다).
 * 기사 끝의 서명("/홍길동 기자")이나 다른 형식은 지우지 못한다 — 자동 탐지는 완전하지 않다.
 */
const BYLINE_PATTERN = /^[[(【〔][^\])】〕]{0,30}[\])】〕]\s*[^=]{0,40}?기자\s*=\s*/;

/**
 * AI에 보내기 전에 본문에서 개인 연락처를 지운다 (PRD 7장).
 * 전화번호·이메일, 기사 앞머리의 기자 줄, 사진 설명 "[사진=…]", 보도자료 끝의 "…에게 연락주시기 바랍니다" 담당자 안내 문장.
 */
export function stripContacts(text: string): string {
  return text
    .replace(BYLINE_PATTERN, "")
    .replace(/\[사진[^\]]{0,80}\]/g, "")
    .replace(/[^.。]{0,200}연락\s*주시기\s*바랍니다\.?/g, "")
    .replace(EMAIL_PATTERN, "")
    .replace(PHONE_PATTERN, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 한국 시각 날짜·시각 문자열(+09:00 기준)을 UTC ISO 문자열로 바꾼다. 잘못된 값이면 undefined. */
export function kstToIso(y: string, mo: string, d: string, h: string, mi: string, s: string): string | undefined {
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}+09:00`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
