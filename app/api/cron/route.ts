// Design Ref: §2.2 자동 실행 주소 — Vercel Cron이 하루 1회 부른다.
// 비밀번호 확인 → 실행권 얻기(조건부 저장) → 시간 예산 안에서 실행 → 결과 저장.
// 실패해도 직전 성공 결과는 지키고 실패만 기록한다 (Design §5).
import { randomUUID, timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getAiMode } from "@/lib/ai/client";
import { kstDay } from "@/lib/format";
import { runDailyPipeline } from "@/lib/pipeline";
import { getStorageKind, getVersionedState, saveStateIfVersion, StateConflictError } from "@/lib/storage";
import type { RadarState, RunRecord } from "@/lib/types";

/** OpenAI 응답을 기다리는 시간을 포함해 최대 300초 (Vercel 무료 플랜 최대값) */
export const maxDuration = 300;

/**
 * 파이프라인 시간 예산: 요청 시작부터 255초. 남은 약 45초는 상태 읽기·실행권 저장(앞)과
 * 결과·실패 기록 저장(뒤)에 쓴다 — 시간 초과로 함수가 강제 종료돼 실패 기록조차 못 남기는 일을 막는다.
 */
const PIPELINE_BUDGET_MS = 255_000;

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

/**
 * 하루 1회 실행권을 얻는다: 읽었던 버전 그대로일 때만 running 기록을 저장한다 (Blob ifMatch).
 * 서버가 여러 대여도 같은 버전에 대한 저장은 하나만 성공하므로, 동시에 부른 요청 중 하나만 실행한다.
 * 성공하면 새 버전, 다른 실행이 먼저 얻었으면 null.
 */
async function claimRun(previous: RadarState, version: string | null, run: RunRecord): Promise<string | null> {
  try {
    return await saveStateIfVersion({ lastSuccess: previous.lastSuccess, lastRun: run }, version);
  } catch (error) {
    if (error instanceof StateConflictError) return null;
    // 저장 응답만 못 받은 경우일 수 있다: 다시 읽어 내 기록이 들어갔는지 확인한다.
    const current = await getVersionedState();
    if (current.state.lastRun?.runId === run.runId) return current.version;
    if (current.version !== version) return null;
    throw error;
  }
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

  // 기존 상태를 읽지 못하면(형식 오류 포함) 아무것도 쓰지 않는다 — 성공 결과가 빈 값으로 덮이는 것 방지 (Design §2 처리 5).
  let previous: RadarState;
  let version: string | null;
  let dailyOnce: boolean;
  try {
    ({ state: previous, version } = await getVersionedState());
    // 하루 1회 보장: 실제 AI 모드 또는 Blob 저장소(배포)에서는 오늘 실행권을 얻은 기록이 있으면 다시 실행하지 않는다.
    // 개발용 메모리 저장소 + 가짜 AI 에서는 반복 시험할 수 있게 진행 중인 실행만 막는다.
    let mode: ReturnType<typeof getAiMode> | "config-error";
    try {
      mode = getAiMode();
    } catch {
      mode = "config-error"; // 설정 오류는 아래 실행 단계에서 실패로 기록된다.
    }
    dailyOnce = mode !== "mock" || getStorageKind() === "blob";
  } catch (error) {
    console.error("[cron] 저장소 읽기 실패", error instanceof Error ? `${error.name}: ${error.message}` : error);
    return Response.json({ status: "error", error: "저장소를 읽지 못해 실행하지 않았습니다" }, { status: 500 });
  }

  const last = previous.lastRun;
  const leaseActive = last?.status === "running" && !!last.leaseUntil && Date.parse(last.leaseUntil) > startedAt;
  if (leaseActive) {
    return Response.json({ status: "skipped", reason: "다른 실행이 진행 중입니다", lastRunAt: last.at });
  }
  if (dailyOnce && last && kstDay(new Date(last.at)) === kstDay(now)) {
    return Response.json({ status: "skipped", reason: "오늘 이미 실행했습니다", lastRunAt: last.at });
  }

  // 실행권 얻기 — 이 저장이 성공한 요청만 수집·AI 호출로 넘어간다.
  const runId = randomUUID();
  const at = now.toISOString();
  let claimVersion: string | null;
  try {
    claimVersion = await claimRun(previous, version, {
      at,
      status: "running",
      issueCount: 0,
      runId,
      leaseUntil: new Date(startedAt + LEASE_MS).toISOString(),
    });
  } catch (error) {
    console.error("[cron] 실행권 저장 실패", error instanceof Error ? `${error.name}: ${error.message}` : error);
    return Response.json({ status: "error", error: "실행권을 저장하지 못해 실행하지 않았습니다" }, { status: 500 });
  }
  if (claimVersion === null) {
    return Response.json({ status: "skipped", reason: "다른 실행이 먼저 시작했습니다" });
  }

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
    next = {
      lastSuccess: previous.lastSuccess,
      lastRun: { at, status: "failed", issueCount: 0, error: message, runId, finishedAt: new Date().toISOString() },
    };
    body = { status: "failed", error: message };
    console.error("[cron] 실패", message);
  }

  // 실행권을 얻을 때의 버전 그대로일 때만 저장한다. 그 사이 누가 바꿨다면 덮어쓰지 않는다.
  try {
    await saveStateIfVersion(next, claimVersion);
  } catch (error) {
    console.error("[cron] 저장 실패", error instanceof Error ? `${error.name}: ${error.message}` : error);
    return Response.json({ ...body, saved: false }, { status: 500 });
  }

  // 저장이 끝났으니 대시보드를 새로 만들도록 신호를 보낸다 (방문자는 저장된 결과만 읽는다).
  revalidatePath("/");
  return Response.json({ ...body, saved: true }, { status: body.status === "failed" ? 500 : 200 });
}
