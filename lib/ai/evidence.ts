// 요약 근거 점검 (코드, 비용 0). AI를 다시 부르지 않고 AI가 읽은 본문과 요약을 비교한다.
// 주의: 이것은 "원문에서 같은 값·비슷한 문장을 찾았는가"를 보는 참고 신호일 뿐, 사실 검증을 보장하지 않는다.
//  - 수치 점검: 숫자 표현이 달라도 같은 값이면 통과시킨다 (2천559 = 2,559, 1,000억 = 1000억원, 10% = 10퍼센트)
//  - 찾지 못한 수치는 줄을 버리지 않고 "수치 확인 필요" 표시만 붙인다 (정상 요약이 표현 차이로 탈락하지 않게)
import type { RawItem, SourceRef, SummaryEvidence } from "@/lib/types";
import { DETAIL_MAX } from "@/lib/sources/preprocess";

/** 묶음 안 기사 사이 구분자 (AI 입력에 그대로 들어간다) */
const SEPARATOR = " / ";
/** 남은 자리가 이보다 짧으면 그 기사는 AI에 사실상 보내지 않은 것으로 보고 근거 목록에서도 뺀다 */
const MIN_EVIDENCE_CHARS = 60;

/** 근거 목록을 만드는 데 쓰는 기사 한 건: 링크 정보 + AI에 보낼 본문 */
interface EvidencePart {
  ref: SourceRef;
  text: string;
}

export function toSourceRef(item: RawItem): SourceRef {
  return { url: item.url, publisher: item.publisher, publishedAt: item.publishedAt };
}

/**
 * 대표 기사(0번)와 같은 사건의 기사 본문을 DETAIL_MAX 자까지 이어 붙인다 (Design §2 처리 3, 세부 요약용).
 * 실제로 들어간 기사만 evidence에 남긴다 — AI가 보지 않은 기사를 근거 링크로 보여주지 않기 위해.
 * 대표 기사는 본문이 없어도 항상 evidence[0]이다.
 */
export function buildDetail(parts: EvidencePart[]): { detail?: string; evidence: EvidencePart[] } {
  const [representative, ...others] = parts;
  const withText = parts.filter((p) => p.text);
  const labeled = withText.length > 1;
  const evidence: EvidencePart[] = [{ ref: representative.ref, text: "" }];
  let detail = "";

  for (const part of withText) {
    const label = labeled ? `[${part.ref.publisher}] ` : "";
    const separator = detail ? SEPARATOR : "";
    const room = DETAIL_MAX - detail.length - separator.length;
    if (room < Math.min(MIN_EVIDENCE_CHARS, label.length + part.text.length)) break;
    const included = `${label}${part.text}`.slice(0, room);
    detail += separator + included;
    const text = included.slice(label.length);
    if (part === representative) evidence[0].text = text;
    else if (others.includes(part)) evidence.push({ ref: part.ref, text });
  }
  return { detail: detail || undefined, evidence };
}

// ─────────────────────────────── 수치 점검 ───────────────────────────────

const BIG_UNITS: Record<string, number> = { 조: 1e12, 억: 1e8, 만: 1e4 };
/** 숫자 + (조·억·만·천 + 숫자)… 형태의 한 덩어리. 뒤의 % 등은 단위 판단에만 쓴다. */
const NUMBER_PHRASE = /\d[\d,]*(?:\.\d+)?(?:\s*[조억만천](?:\s*\d[\d,]*(?:\.\d+)?)?)*(\s*(?:%|퍼센트|배|%p))?/g;

/** "2천559" → 2559, "1조 2,000억" → 1.2e12, "3,000억" → 3e11 */
function phraseValue(phrase: string): number | undefined {
  let total = 0;
  let section = 0;
  let current: number | undefined;
  for (const [token] of phrase.matchAll(/\d[\d,]*(?:\.\d+)?|[조억만천]/g)) {
    if (token === "천") {
      section += (current ?? 1) * 1000;
      current = undefined;
    } else if (token in BIG_UNITS) {
      total += (section + (current ?? (section ? 0 : 1))) * BIG_UNITS[token];
      section = 0;
      current = undefined;
    } else {
      current = Number(token.replace(/,/g, ""));
    }
  }
  const value = total + section + (current ?? 0);
  return Number.isFinite(value) ? value : undefined;
}

interface NumberMention {
  text: string;
  /** 같은 값으로 인정할 후보들 ("10.16"은 소수 10.16 또는 날짜 10월 16일일 수 있다) */
  values: number[][];
}

/** 글에서 수치 표현을 뽑는다. 단위 없는 1~10 정수(차례·횟수 등)는 한글 수사와 섞여 쓰여 점검에서 뺀다. */
function numberMentions(text: string): NumberMention[] {
  const mentions: NumberMention[] = [];
  for (const match of text.matchAll(NUMBER_PHRASE)) {
    const phrase = match[0].trim();
    const value = phraseValue(phrase);
    if (value === undefined) continue;
    const hasUnit = !!match[1] || /[조억만천]/.test(phrase);
    if (!hasUnit && Number.isInteger(value) && value <= 10) continue;
    const values: number[][] = [[value]];
    // "10.16"처럼 점으로 나뉜 숫자는 날짜·버전일 수 있어 각 부분이 모두 있어도 같은 것으로 본다
    if (/^\d+\.\d+$/.test(phrase)) values.push(phrase.split(".").map(Number));
    mentions.push({ text: phrase, values });
  }
  return mentions;
}

/** 원문에 있는 수치 값 모음 (점으로 나뉜 숫자는 각 부분도 넣는다) */
function numberSet(text: string): Set<number> {
  const set = new Set<number>();
  for (const match of text.matchAll(NUMBER_PHRASE)) {
    const phrase = match[0].trim();
    const value = phraseValue(phrase);
    if (value !== undefined) set.add(value);
    for (const part of phrase.split(/[.\s조억만천]/)) {
      const n = Number(part.replace(/,/g, ""));
      if (part && Number.isFinite(n)) set.add(n);
    }
  }
  return set;
}

function found(mention: NumberMention, set: Set<number>): boolean {
  return mention.values.some((candidate) => candidate.every((v) => set.has(v)));
}

// ─────────────────────────────── 근거 기사 찾기 ───────────────────────────────

/** 글자 두 개씩 묶음 (한글·영문·숫자만). 조사·띄어쓰기가 달라도 겹치는 정도를 볼 수 있다. */
function bigrams(text: string): Set<string> {
  const chars = text.replace(/[^\p{L}\p{N}]/gu, "");
  const set = new Set<string>();
  for (let i = 0; i < chars.length - 1; i += 1) set.add(chars.slice(i, i + 2));
  return set;
}

/** 이 정도 이상 겹쳐야 근거 기사로 표시한다. 둘째로 비슷한 기사와 차이가 작으면 표시하지 않는다. */
const MIN_OVERLAP = 0.5;
const MIN_MARGIN = 0.1;

function bestSource(line: string, sourceGrams: Set<string>[]): number | null {
  const grams = bigrams(line);
  if (grams.size === 0) return null;
  const scores = sourceGrams.map((source) => {
    let hit = 0;
    grams.forEach((g) => {
      if (source.has(g)) hit += 1;
    });
    return hit / grams.size;
  });
  const order = scores.map((score, index) => ({ score, index })).sort((a, b) => b.score - a.score);
  const [first, second] = order;
  if (!first || first.score < MIN_OVERLAP) return null;
  if (second && first.score - second.score < MIN_MARGIN) return null;
  return first.index;
}

/**
 * 요약 각 줄을 점검한다.
 * - source: 줄과 가장 많이 겹치는 근거 기사 번호 (애매하면 null)
 * - unverifiedNumbers: AI가 읽은 본문·제목 어디에서도 같은 값을 찾지 못한 수치
 */
export function checkSummary(
  summary: string[],
  item: RawItem,
  evidence: EvidencePart[],
): SummaryEvidence[] {
  const corpus = numberSet([item.title, item.detail ?? "", item.excerpt ?? ""].join(" "));
  // 대표 기사는 제목도 AI에 보냈으므로 제목까지 근거로 본다
  const sourceGrams = evidence.map((e, i) => bigrams(i === 0 ? `${item.title} ${e.text}` : e.text));
  return summary.map((line) => ({
    source: bestSource(line, sourceGrams),
    unverifiedNumbers: [...new Set(numberMentions(line).filter((m) => !found(m, corpus)).map((m) => m.text))],
  }));
}
