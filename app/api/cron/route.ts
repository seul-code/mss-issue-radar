// Design Ref: §2.2 자동 실행 주소 — Vercel Cron이 하루 1회 부른다.
// 비밀번호 확인 → 실행권 얻기(조건부 저장) → 시간 예산 안에서 실행 → 날짜별 기록 보관 → 최신 결과 저장 → 화면 갱신.
// 실패해도 직전 성공 결과는 지키고 실패만 기록한다 (Design §5).
import { randomUUID, timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getAiMode } from "@/lib/ai/client";
import { kstDay } from "@/lib/format";
import { recordHistory } from "@/lib/history";
import { runDailyPipeline } from "@/lib/pipeline";
import { getStorageKind, getVersionedState, saveStateChecked } from "@/lib/storage";
import type { RadarState, RunRecord } from "@/lib/types";

/** OpenAI 응답을 기다리는 시간을 포함해 최대 300초 (Vercel 무료 플랜 최대값) */
export const maxDuration = 300;

/**
 * 파이프라인 시간 예산: 요청 시작부터 255초. 남은 약 45초는 상태 읽기·실행권 저장(앞)과
 * 결과·실패 기록 저장(뒤)에 쓴다 — 시간 초과로 함수가 강제 종료돼 실패 기록조차 못 남기는 일을 줄인다.
 */
const PIPELINE_BUDGET_MS = 255_000;

/**
 * 저장소 작업(읽기·저장) 시간 제한: 요청 시작부터 290초. Blob SDK 의 abortSignal 로 넘긴다.
 * 보장 범위: SDK 는 쓰기를 기본 최대 10회 다시 시도하고, 재시도 사이 대기 중에는 취소가 다음 시도 때 반영된다.
 * 그래서 290초 안에 끝난다고 보장할 수는 없고, 300초에 강제 종료되면 running 기록이 남을 수 있다 (화면은 "중간에 멈췄습니다").
 */
const STORAGE_LIMIT_MS = 290_000;

/** running 기록이 이 시간을 넘기면 강제 종료된 것으로 본다 (함수 최대 시간 + 여유 1분) */
const LEASE_MS = (maxDuration + 60) * 1000;

/** 실패 이유는 기록용으로만 짧게 남긴다 (화면에는 표시하지 않음, 키 값은 원래 포함되지 않음). */
const MAX_ERROR_LENGTH = 300;

/** 명시적인 로컬 개발(next dev, Vercel 밖)인지. next start·preview·production 은 해당하지 않는다. */
function isLocalDevelopment(): boolean {
  return process.env.NODE_ENV === "development" && !process.env.VERCEL;
}

/**
 * CLAUDE.md 2장: 외부에서 아무나 불러 요금이 나가지 않게 비밀번호로 막는다.
 * Vercel Cron은 "Authorization: Bearer <CRON_SECRET>" 머리글을 붙여 부른다.
 * CRON_SECRET 이 없을 때 통과시키는 것은 로컬 개발(next dev)뿐이다. preview 를 포함한 모든 배포는 막는다.
 */
function checkAuth(request: Request): "ok" | "unauthorized" | "missing-secret" {
  const secret = process.env.CRON_SECRET;
  if (!secret) return isLocalDevelopment() ? "ok" : "missing-secret";
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  // 글자를 비교하는 시간 차이로 비밀번호를 추측하지 못하게 일정한 시간으로 비교한다.
  return given.length === expected.length && timingSafeEqual(given, expected) ? "ok" : "unauthorized";
}

function errorMessage(error: unknown, budgetSignal: AbortSignal): string {
  if (budgetSignal.aborted) return `시간 예산(${PIPELINE_BUDGET_MS / 1000}초) 초과로 중단했습니다`;
  return (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, MAX_ERROR_LENGTH);
}

function logError(label: string, error: unknown) {
  console.error(label, error instanceof Error ? `${error.name}: ${error.message}` : error);
}

export async function GET(request: Request) {
  const auth = checkAuth(request);
  if (auth === "missing-secret") {
    return Response.json({ status: "error", error: "CRON_SECRET 이 설정되지 않았습니다" }, { status: 500 });
  }
  if (auth === "unauthorized") return Response.json({ status: "unauthorized" }, { status: 401 });

  const startedAt = Date.now();
  const now = new Date(startedAt);
  const budgetSignal = AbortSignal.timeout(PIPELINE_BUDGET_MS);
  const storageSignal = AbortSignal.timeout(STORAGE_LIMIT_MS);

  // 시험 데이터 차단 (Design §9): 운영 저장소(Blob)에는 실제 AI 결과만 저장한다. 저장소를 읽거나 쓰기 전에 확인한다.
  // 저장소 종류는 실행 환경(VERCEL_ENV)으로 정해지므로, 로컬·preview 에서는 AI_MODE 와 관계없이 운영 기록에 닿지 않는다.
  let mode: ReturnType<typeof getAiMode> | "config-error";
  try {
    mode = getAiMode();
  } catch {
    mode = "config-error"; // 설정 오류는 아래 실행 단계에서 실패로 기록된다 (가짜 결과는 만들지 않음).
  }
  let storageKind: ReturnType<typeof getStorageKind>;
  try {
    storageKind = getStorageKind();
  } catch (error) {
    logError("[cron] 저장소 설정 오류", error);
    return Response.json({ status: "error", error: "저장소 설정이 잘못돼 실행하지 않았습니다" }, { status: 500 });
  }
  if (storageKind === "blob" && mode === "mock") {
    console.error("[cron] 가짜 AI 결과를 운영 저장소에 저장하려 해 실행하지 않았습니다");
    return Response.json({ status: "error", error: "시험(가짜 AI) 결과는 운영 저장소에 저장할 수 없습니다" }, { status: 500 });
  }

  // 기존 상태를 읽지 못하면(깨진 JSON·형식 오류 포함) 아무것도 쓰지 않는다 — 원본을 덮어쓰지 않고 원인 확인용으로 남긴다 (Design §2 처리 5).
  let previous: RadarState;
  let version: string | null;
  try {
    ({ state: previous, version } = await getVersionedState(storageSignal));
  } catch (error) {
    logError("[cron] 저장소 읽기 실패", error);
    return Response.json({ status: "error", error: "저장소를 읽지 못해 실행하지 않았습니다" }, { status: 500 });
  }

  // 하루 1회 보장: 실제 AI 모드 또는 Blob 저장소(운영)에서는 오늘 실행권을 얻은 기록이 있으면 다시 실행하지 않는다.
  // 개발용 메모리 저장소 + 가짜 AI 에서는 반복 시험할 수 있게 진행 중인 실행만 막는다.
  const dailyOnce = mode !== "mock" || storageKind === "blob";
  const last = previous.lastRun;
  const leaseActive = last?.status === "running" && !!last.leaseUntil && Date.parse(last.leaseUntil) > startedAt;
  if (leaseActive) {
    return Response.json({ status: "skipped", reason: "다른 실행이 진행 중입니다", lastRunAt: last.at });
  }
  if (dailyOnce && last && kstDay(new Date(last.at)) === kstDay(now)) {
    return Response.json({ status: "skipped", reason: "오늘 이미 실행했습니다", lastRunAt: last.at });
  }

  // 실행권 얻기 — 읽었던 버전 그대로일 때만 running 기록을 저장한다 (Blob ifMatch). 이 저장이 성공한 요청만 수집·AI 호출로 넘어간다.
  // 412·연결 오류가 나도 바로 "충돌"로 보지 않고 다시 읽어, 저장된 running 기록의 실행 식별값(runId)이 내 것이면 실행권을 얻은 것으로 본다.
  const runId = randomUUID();
  const at = now.toISOString();
  const claimRecord: RunRecord = {
    at,
    status: "running",
    issueCount: 0,
    runId,
    leaseUntil: new Date(startedAt + LEASE_MS).toISOString(),
  };
  const claim = await saveStateChecked(
    { lastSuccess: previous.lastSuccess, lastRun: claimRecord },
    version,
    (current) => current.lastRun?.runId === runId && current.lastRun.status === "running",
    storageSignal,
  );
  if (claim.result === "conflict") {
    return Response.json({ status: "skipped", reason: "다른 실행이 먼저 시작했습니다" });
  }
  if (claim.result === "failed") {
    logError(`[cron] 실행권 저장 실패${claim.uncertain ? " (저장 여부 확인 못 함)" : ""}`, claim.error);
    return Response.json({ status: "error", error: "실행권을 저장하지 못해 실행하지 않았습니다" }, { status: 500 });
  }
  const claimVersion = claim.version;

  let next: RadarState;
  let body: Record<string, unknown>;
  try {
    const result = await runDailyPipeline(now, { deadlineAt: startedAt + PIPELINE_BUDGET_MS, signal: budgetSignal });
    const finishedAt = new Date().toISOString();
    next =
      result.status === "success"
        ? {
            lastSuccess: { issues: result.issues, generatedAt: at, window: result.window },
            lastRun: { at, status: "success", issueCount: result.issues.length, runId, finishedAt },
          }
        : { lastSuccess: previous.lastSuccess, lastRun: { at, status: "empty", issueCount: 0, runId, finishedAt } };
    body = { status: result.status, issueCount: result.issues.length, stats: result.stats };
    console.log("[cron] 완료", JSON.stringify(body));
  } catch (error) {
    const message = errorMessage(error, budgetSignal);
    const timedOut = budgetSignal.aborted;
    next = {
      lastSuccess: previous.lastSuccess,
      lastRun: {
        at,
        status: "failed",
        issueCount: 0,
        error: message,
        runId,
        finishedAt: new Date().toISOString(),
        ...(timedOut ? { timedOut: true } : {}),
      },
    };
    body = { status: "failed", error: message, ...(timedOut ? { timedOut: true } : {}) };
    console.error("[cron] 실패", message);
  }

  // 날짜별 기록 보관 (① 날짜별 파일 → ② 날짜 목록). 실패해도 최신 결과 저장(③)은 계속하고 이유만 남긴다.
  let historyError: string | undefined;
  let changedDates = [kstDay(now)];
  try {
    ({ error: historyError, changedDates } = await recordHistory(previous, next, storageSignal));
  } catch (error) {
    historyError = `날짜별 기록 보관 실패: ${error instanceof Error ? error.message : String(error)}`.slice(0, MAX_ERROR_LENGTH);
  }
  if (historyError && next.lastRun) {
    next = { ...next, lastRun: { ...next.lastRun, historyError } };
    body = { ...body, historyError };
    console.error("[cron] 날짜별 기록 보관 일부 실패", historyError);
  }

  // ③ 최신 결과 — 실행권을 얻을 때의 버전 그대로일 때만 저장한다. 그 사이 다른 실행이 바꿨다면 덮어쓰지 않는다.
  // 412·연결 오류여도 다시 읽어 내 결과(runId·상태·끝난 시각)가 들어가 있으면 저장된 것으로 본다.
  const expected = next.lastRun;
  const saved = await saveStateChecked(
    next,
    claimVersion,
    (current) =>
      current.lastRun?.runId === runId &&
      current.lastRun.status === expected?.status &&
      current.lastRun.finishedAt === expected?.finishedAt,
    storageSignal,
  );

  // 화면 갱신: ①② 에서 바뀐 날짜 화면(오늘 + 복구한 날짜)과 대시보드(최근 기록 칩)는 ③ 결과와 관계없이 다시 만든다.
  // ③ 이 실패해도 이미 저장된 날짜 기록의 화면 갱신을 막지 않는다 (방문자는 저장된 결과만 읽는다).
  revalidatePath("/");
  for (const date of changedDates) revalidatePath(`/d/${date}`);

  if (saved.result !== "saved") {
    if (saved.result === "conflict") console.error("[cron] 최신 결과 저장 안 함 — 다른 실행이 먼저 바꿈 (덮어쓰지 않음)");
    else logError(`[cron] 최신 결과 저장 실패${saved.uncertain ? " (저장 여부 확인 못 함)" : ""}`, saved.error);
    return Response.json({ ...body, saved: false, saveResult: saved.result }, { status: 500 });
  }
  return Response.json({ ...body, saved: true }, { status: body.status === "failed" ? 500 : 200 });
}
