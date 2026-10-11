// RSS·API 응답(XML)을 읽는 작은 도구 모음. 구조가 단순해 별도 라이브러리 없이 처리한다 (Design §3).

/** <tag><![CDATA[값]]></tag> 또는 <tag>값</tag> 에서 값을 꺼낸다. */
export function readTag(block: string, tag: string): string | undefined {
  const match = block.match(new RegExp(`<${tag}>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))\\s*</${tag}>`));
  const value = (match?.[1] ?? match?.[2])?.trim();
  return value || undefined;
}

/** 자주 나오는 HTML 문자 표기를 글자로 바꾼다 (&middot; → · 등) */
export function decodeEntities(text: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·", hellip: "…", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”" };
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (whole, name) => named[name.toLowerCase()] ?? whole);
}

/** HTML 태그를 지우고 공백을 정리한 순수 글자 */
export function toPlainText(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** 한국 시각 날짜·시각 문자열(+09:00 기준)을 UTC ISO 문자열로 바꾼다. 잘못된 값이면 undefined. */
export function kstToIso(y: string, mo: string, d: string, h: string, mi: string, s: string): string | undefined {
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}+09:00`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
