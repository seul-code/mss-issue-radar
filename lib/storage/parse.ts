// 저장소에서 읽은 JSON을 RadarState로 검증한다 (새 패키지 없이 직접 검사).
// - 전체 구조(lastSuccess·lastRun)가 틀리면 StateFormatError — 자동 실행은 덮어쓰지 않고 멈추고, 파일은 원인 확인용으로 남는다
// - 이슈 하나만 틀리면 그 이슈만 빼고 나머지는 쓴다
// - 링크는 http(s) 주소만 허용한다 (javascript: 같은 주소가 화면 링크로 들어가는 것 방지)
import { CATEGORIES } from "@/lib/categories";
import type {
  Category,
  CollectionWindow,
  Importance,
  Issue,
  RadarState,
  RunRecord,
  RunStatus,
  SourceRef,
  SummaryEvidence,
} from "@/lib/types";

export class StateFormatError extends Error {
  name = "StateFormatError";
}

type Obj = Record<string, unknown>;

const VALID_CATEGORIES = new Set<string>(CATEGORIES);
const VALID_IMPORTANCE = new Set<string>(["high", "medium", "low"]);
const VALID_STATUS = new Set<string>(["running", "success", "empty", "failed"]);

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isoDate(value: unknown): string | undefined {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : undefined;
}

function httpUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? value : undefined;
  } catch {
    return undefined;
  }
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "") : [];
}

function parseSourceRef(value: unknown): SourceRef | undefined {
  if (!isObj(value)) return undefined;
  const url = httpUrl(value.url);
  const publisher = str(value.publisher);
  const publishedAt = isoDate(value.publishedAt);
  return url && publisher && publishedAt ? { url, publisher, publishedAt } : undefined;
}

function parseEvidence(value: unknown, summaryLength: number, sourceCount: number): SummaryEvidence[] | undefined {
  if (!Array.isArray(value) || value.length !== summaryLength) return undefined;
  const parsed = value.map((entry): SummaryEvidence | undefined => {
    if (!isObj(entry)) return undefined;
    const source =
      typeof entry.source === "number" && Number.isInteger(entry.source) && entry.source >= 0 && entry.source < sourceCount
        ? entry.source
        : null;
    return { source, unverifiedNumbers: strings(entry.unverifiedNumbers) };
  });
  return parsed.every((e): e is SummaryEvidence => !!e) ? parsed : undefined;
}

/** 이슈 하나를 검사한다. 필수 항목이 틀리면 undefined (그 이슈만 버림). */
export function parseIssue(value: unknown): Issue | undefined {
  if (!isObj(value)) return undefined;
  const id = str(value.id);
  const title = str(value.title);
  const publishedAt = isoDate(value.publishedAt);
  const sourceName = str(value.sourceName);
  const sourceUrl = httpUrl(value.sourceUrl);
  const importance = typeof value.importance === "string" && VALID_IMPORTANCE.has(value.importance)
    ? (value.importance as Importance)
    : undefined;
  const categories = strings(value.categories).filter((c) => VALID_CATEGORIES.has(c)).slice(0, 2) as Category[];
  // 예전 형식(한 문장)으로 저장된 결과도 목록으로 맞춘다
  const summary = typeof value.summary === "string" ? strings([value.summary]) : strings(value.summary);
  const relevance = str(value.relevance);
  const ideas = strings(value.ideas);
  if (!id || !title || !publishedAt || !sourceName || !sourceUrl || !importance) return undefined;
  if (categories.length === 0 || summary.length === 0 || !relevance) return undefined;

  const sources = Array.isArray(value.sources)
    ? value.sources.map(parseSourceRef).filter((s): s is SourceRef => !!s)
    : undefined;
  const issue: Issue = {
    id,
    title,
    publishedAt,
    sourceName,
    importance,
    categories,
    summary,
    relevance,
    ideas,
    sourceUrl,
  };
  const importanceReason = str(value.importanceReason);
  if (importanceReason) issue.importanceReason = importanceReason;
  if (value.importanceReasonMissing === true) issue.importanceReasonMissing = true;
  const followUp = str(value.followUp);
  if (followUp) issue.followUp = followUp;
  if (sources && sources.length > 0) {
    issue.sources = sources;
    const evidence = parseEvidence(value.summaryEvidence, summary.length, sources.length);
    if (evidence) issue.summaryEvidence = evidence;
  }
  return issue;
}

function parseWindow(value: unknown): CollectionWindow | undefined {
  if (!isObj(value)) return undefined;
  const from = isoDate(value.from);
  const to = isoDate(value.to);
  return from && to && (value.hours === 24 || value.hours === 48) ? { from, to, hours: value.hours } : undefined;
}

function parseRunRecord(value: unknown): RunRecord {
  if (!isObj(value)) throw new StateFormatError("lastRun 형식이 맞지 않습니다");
  const at = isoDate(value.at);
  const status = typeof value.status === "string" && VALID_STATUS.has(value.status) ? (value.status as RunStatus) : undefined;
  if (!at || !status) throw new StateFormatError("lastRun.at 또는 lastRun.status 가 맞지 않습니다");
  const record: RunRecord = {
    at,
    status,
    issueCount: typeof value.issueCount === "number" && value.issueCount >= 0 ? value.issueCount : 0,
  };
  const error = str(value.error);
  if (error) record.error = error;
  const runId = str(value.runId);
  if (runId) record.runId = runId;
  const leaseUntil = isoDate(value.leaseUntil);
  if (leaseUntil) record.leaseUntil = leaseUntil;
  const finishedAt = isoDate(value.finishedAt);
  if (finishedAt) record.finishedAt = finishedAt;
  return record;
}

/** 저장소에서 읽은 JSON을 검사해 RadarState로 돌려준다. 전체 구조가 틀리면 StateFormatError. */
export function parseRadarState(data: unknown): RadarState {
  if (!isObj(data) || !("lastSuccess" in data) || !("lastRun" in data)) {
    throw new StateFormatError("저장된 상태의 형식이 맞지 않습니다");
  }

  let lastSuccess: RadarState["lastSuccess"] = null;
  if (data.lastSuccess !== null) {
    const value = data.lastSuccess;
    const generatedAt = isObj(value) ? isoDate(value.generatedAt) : undefined;
    if (!isObj(value) || !Array.isArray(value.issues) || !generatedAt) {
      throw new StateFormatError("lastSuccess 형식이 맞지 않습니다");
    }
    lastSuccess = {
      issues: value.issues.map(parseIssue).filter((issue): issue is Issue => !!issue),
      generatedAt,
    };
    const window = parseWindow(value.window);
    if (window) lastSuccess.window = window;
  }

  return { lastSuccess, lastRun: data.lastRun === null ? null : parseRunRecord(data.lastRun) };
}
