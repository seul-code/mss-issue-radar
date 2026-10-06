// Design Ref: §2.1 시간 기준 — 저장은 UTC, 화면 표시는 한국 시각.
const kstFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** UTC ISO 시각을 한국 시각 "10. 7. 07:10" 형태로 바꾼다. */
export function formatKst(iso: string): string {
  return kstFormatter.format(new Date(iso));
}
