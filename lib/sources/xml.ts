// RSS·API 응답(XML)을 읽는 작은 도구 모음. 구조가 단순해 별도 라이브러리 없이 처리한다 (Design §3).

/** <tag><![CDATA[값]]></tag> 또는 <tag>값</tag> 에서 값을 꺼낸다. */
export function readTag(block: string, tag: string): string | undefined {
  const match = block.match(new RegExp(`<${tag}>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))\\s*</${tag}>`));
  const value = (match?.[1] ?? match?.[2])?.trim();
  return value || undefined;
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
 * AI에 보내기 전에 본문에서 개인 연락처를 지운다 (PRD 7장).
 * 전화번호·이메일, 기사 앞머리의 "(서울=연합뉴스) 홍길동 기자 =", 사진 설명 "[사진=…]",
 * 보도자료 끝의 "…에게 연락주시기 바랍니다" 담당자 안내 문장.
 */
export function stripContacts(text: string): string {
  return text
    .replace(/^[[(][^\])]{0,30}[\])]\s*[^=]{0,40}?기자\s*=\s*/, "")
    .replace(/\[사진[^\]]{0,80}\]/g, "")
    .replace(/[^.。]{0,200}연락\s*주시기\s*바랍니다\.?/g, "")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "")
    .replace(/\(?\b0\d{1,2}[-.)\s]?\d{3,4}[-.\s]?\d{4}\b\)?/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 한국 시각 날짜·시각 문자열(+09:00 기준)을 UTC ISO 문자열로 바꾼다. 잘못된 값이면 undefined. */
export function kstToIso(y: string, mo: string, d: string, h: string, mi: string, s: string): string | undefined {
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}+09:00`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
