// Design Ref: §2.2 자동 실행 주소 — Vercel Cron이 하루 1회 부른다.
// 비밀번호 확인 → 하루 1회 중복 방지 → 실행 → 저장. 실패해도 직전 성공 결과는 지키고 실패만 기록한다 (Design §5).
import { revalidatePath } from "next/cache";
import { getAiMode } from "@/lib/ai/client";
import { runDailyPipeline } from "@/lib/pipeline";
import { getState, saveState } from "@/lib/storage";
import type { RadarState } from "@/lib/types";

/** OpenAI 응답을 기다리는 시간을 포함해 최대 300초 (Vercel 무료 플랜 최대값) */
export const maxDuration = 300;

/** 실패 이유는 기록용으로만 짧게 남긴다 (화면에는 표시하지 않음, 키 값은 원래 포함되지 않음). */
const MAX_ERROR_LENGTH = 300;

/** 한국 날짜 "YYYY-MM-DD" — "오늘 이미 실행했는지" 판단용 (Design §2.1) */
function kstDay(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(date);
}

/**
 * CLAUDE.md 2장: 외부에서 아무나 불러 요금이 나가지 않게 비밀번호로 막는다.
 * Vercel Cron은 "Authorization: Bearer <CRON_SECRET>" 머리글을 붙여 부른다.
 * 개발 중 CRON_SECRET 을 넣지 않았다면 로컬 시험을 위해 통과시킨다 (배포에서는 반드시 필요).
 */
function isAuthorized(request: Request): boolean | "missing-secret" {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.VERCEL_ENV === "production" ? "missing-secret" : true;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  const auth = isAuthorized(request);
  if (auth === "missing-secret") {
    return Response.json({ status: "error", error: "CRON_SECRET 이 설정되지 않았습니다" }, { status: 500 });
  }
  if (!auth) return Response.json({ status: "unauthorized" }, { status: 401 });

  const now = new Date();

  // 기존 상태를 읽지 못하면 아무것도 쓰지 않는다 — 성공 결과가 빈 값으로 덮이는 것 방지 (Design §2 처리 5).
  let previous: RadarState;
  try {
    previous = await getState();
  } catch (error) {
    console.error("[cron] 저장소 읽기 실패", error instanceof Error ? error.message : error);
    return Response.json({ status: "error", error: "저장소를 읽지 못해 실행하지 않았습니다" }, { status: 500 });
  }

  // 하루 1회 보장: 실제 AI 모드에서 오늘(한국 날짜) 이미 실행했으면 AI를 부르지 않는다 (Design §2.2).
  let mode: ReturnType<typeof getAiMode> | "config-error";
  try {
    mode = getAiMode();
  } catch {
    mode = "config-error"; // 설정 오류는 아래 실행 단계에서 실패로 기록된다.
  }
  if (mode === "live" && previous.lastRun && kstDay(new Date(previous.lastRun.at)) === kstDay(now)) {
    return Response.json({ status: "skipped", reason: "오늘 이미 실행했습니다", lastRunAt: previous.lastRun.at });
  }

  let next: RadarState;
  let body: Record<string, unknown>;
  try {
    const result = await runDailyPipeline(now);
    const at = now.toISOString();
    next =
      result.status === "success"
        ? {
            lastSuccess: { issues: result.issues, generatedAt: at },
            lastRun: { at, status: "success", issueCount: result.issues.length },
          }
        : { lastSuccess: previous.lastSuccess, lastRun: { at, status: "empty", issueCount: 0 } };
    body = { status: result.status, issueCount: result.issues.length, stats: result.stats };
    console.log("[cron] 완료", JSON.stringify(body));
  } catch (error) {
    const message = (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(
      0,
      MAX_ERROR_LENGTH,
    );
    next = {
      lastSuccess: previous.lastSuccess,
      lastRun: { at: now.toISOString(), status: "failed", issueCount: 0, error: message },
    };
    body = { status: "failed", error: message };
    console.error("[cron] 실패", message);
  }

  try {
    await saveState(next);
  } catch (error) {
    console.error("[cron] 저장 실패", error instanceof Error ? error.message : error);
    return Response.json({ ...body, saved: false }, { status: 500 });
  }

  // 저장이 끝났으니 대시보드를 새로 만들도록 신호를 보낸다 (방문자는 저장된 결과만 읽는다).
  revalidatePath("/");
  return Response.json({ ...body, saved: true }, { status: body.status === "failed" ? 500 : 200 });
}
