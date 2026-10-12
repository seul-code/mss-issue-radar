// Design Ref: §1 ② 상태 안내, §5 오류 처리 — 실패·0건·결과 없음일 때만 보인다. 정상일 때는 아무것도 그리지 않는다.
import { formatKst } from "@/lib/format";
import type { RadarState } from "@/lib/types";

const STYLE = {
  warning: "bg-coral-100 text-coral-700 ring-coral-300",
  info: "bg-butter-100 text-butter-700 ring-butter-300",
};

export default function StatusBanner({ state }: { state: RadarState }) {
  const { lastSuccess, lastRun } = state;

  let tone: keyof typeof STYLE;
  let icon: string;
  let message: string;

  if (lastRun?.status === "failed") {
    // PRD 5장: 자동 처리 실패 시 직전 결과를 그대로 두고 마지막 성공 시각을 알린다.
    tone = "warning";
    icon = "⚠️";
    message = `업데이트 실패, 마지막 성공 시각: ${lastSuccess ? formatKst(lastSuccess.generatedAt) : "없음"}`;
  } else if (!lastSuccess) {
    // 첫 배포 직후처럼 저장된 결과가 아직 없을 때
    tone = "info";
    icon = "🌙";
    message = "아직 수집된 이슈가 없습니다";
  } else if (lastRun?.status === "empty") {
    // PRD 5장: 0건인 날(주말·공휴일)에는 안내와 함께 직전 결과를 계속 보여준다.
    tone = "info";
    icon = "☕";
    message = "오늘은 새 이슈가 없습니다 (직전 결과를 보여드립니다)";
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
