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

const kstDateFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "long",
  day: "numeric",
  weekday: "short",
});

/** UTC ISO 시각을 한국 날짜 "10월 7일 (수)" 형태로 바꾼다 (집계 기준일 표시용). */
export function formatKstDate(iso: string): string {
  return kstDateFormatter.format(new Date(iso)).replace(/\s*\((.)\)$/, " ($1)");
}

/** 한국 날짜 "YYYY-MM-DD" (문자열 비교로 날짜 앞뒤를 알 수 있다) */
export function kstDay(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(date);
}

/** 한국 시각의 시(0~23) */
export function kstHour(date: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", hour: "numeric", hourCycle: "h23" }).format(date));
}
