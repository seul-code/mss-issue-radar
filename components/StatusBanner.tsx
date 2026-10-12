// Design Ref: §1 ② 상태 안내, §5 오류 처리 — 실패·중단·지연·0건·결과 없음일 때만 보인다. 정상일 때는 아무것도 그리지 않는다.
// 직전 결과를 보여줄 때는 그 결과가 언제 기준인지(집계 기준일)를 함께 알린다.
import { formatKst, formatKstDate, kstDay, kstHour } from "@/lib/format";
import type { RadarState } from "@/lib/types";

const STYLE = {
  warning: "bg-coral-100 text-coral-700 ring-coral-300",
  info: "bg-butter-100 text-butter-700 ring-butter-300",
};

/**
 * 예약 실행은 한국 시각 7시대(Vercel 무료 플랜은 7시~7시 59분 사이 아무 때나)라서,
 * 9시가 지나도 오늘 실행 기록이 없으면 지연으로 본다. 9시 전에는 어제 실행까지를 정상으로 본다.
 */
const EXPECTED_BY_HOUR = 9;

function expectedRunDay(now: Date): string {
  return kstHour(now) >= EXPECTED_BY_HOUR ? kstDay(now) : kstDay(new Date(now.getTime() - 24 * 3600_000));
}

interface Props {
  state: RadarState;
  /** 판단 기준 시각 (ms). 화면을 만든 시각 — 데모에서는 샘플에 맞춘 시각 */
  now: number;
  /** 저장된 결과의 형식이 맞지 않아 읽지 못한 경우 */
  unreadable?: boolean;
}

export default function StatusBanner({ state, now, unreadable }: Props) {
  const { lastSuccess, lastRun } = state;
  const nowDate = new Date(now);
  // 지금 보이는 결과의 집계 기준일
  const basis = lastSuccess ? `${formatKstDate(lastSuccess.window?.to ?? lastSuccess.generatedAt)} 기준 결과` : "";
  const showing = lastSuccess ? ` — 아래는 ${basis}입니다` : "";

  let tone: keyof typeof STYLE;
  let icon: string;
  let message: string;

  if (unreadable) {
    tone = "warning";
    icon = "⚠️";
    message = "저장된 결과를 읽을 수 없습니다. 다음 자동 실행 전까지 관리자 확인이 필요합니다";
  } else if (lastRun?.status === "running" && lastRun.leaseUntil && Date.parse(lastRun.leaseUntil) <= now) {
    // 실행권을 얻은 뒤 시간 초과 등으로 강제 종료돼 결과를 남기지 못한 경우. 같은 날 자동으로 다시 실행하지 않는다.
    tone = "warning";
    icon = "⚠️";
    message = `업데이트가 중간에 멈췄습니다 (시작: ${formatKst(lastRun.at)})${showing}`;
  } else if (lastRun?.status === "running") {
    tone = "info";
    icon = "⏳";
    message = `업데이트가 진행 중입니다${showing}`;
  } else if (lastSuccess && (!lastRun || kstDay(new Date(lastRun.at)) < expectedRunDay(nowDate))) {
    // 예약 실행이 누락돼 오늘 실행 기록이 없는 경우 (마지막 실행 날짜 기준)
    tone = "warning";
    icon = "⏰";
    message = `오늘 업데이트가 아직 실행되지 않았습니다 (마지막 실행: ${lastRun ? formatKst(lastRun.at) : "없음"})${showing}`;
  } else if (lastRun?.status === "failed" && lastRun.timedOut) {
    // PRD 5장: 시간 초과로 중간에 멈춘 경우 — 실패 기록은 저장됐지만 안내는 "중간에 멈췄습니다"로 한다.
    tone = "warning";
    icon = "⚠️";
    message = `업데이트가 중간에 멈췄습니다 (시작: ${formatKst(lastRun.at)})${showing}`;
  } else if (lastRun?.status === "failed") {
    // PRD 5장: 자동 처리 실패 시 직전 결과를 그대로 두고 마지막 성공 시각을 알린다.
    tone = "warning";
    icon = "⚠️";
    message = `업데이트 실패, 마지막 성공 시각: ${lastSuccess ? `${formatKst(lastSuccess.generatedAt)} (${basis})` : "없음"}`;
  } else if (!lastSuccess) {
    // 첫 배포 직후처럼 저장된 결과가 아직 없을 때
    tone = "info";
    icon = "🌙";
    message = "아직 수집된 이슈가 없습니다";
  } else if (lastRun?.status === "empty") {
    // PRD 5장: 0건인 날(주말·공휴일)에는 안내와 함께 직전 결과를 계속 보여준다.
    tone = "info";
    icon = "☕";
    message = `오늘은 새 이슈가 없습니다 (직전 결과를 보여드립니다 · ${basis})`;
  } else {
    return null;
  }

  return (
    <p role="status" className={`animate-fade rounded-3xl px-5 py-3.5 text-sm font-semibold ring-1 ${STYLE[tone]}`}>
      <span aria-hidden="true">{icon} </span>
      {message}
    </p>
  );
}
