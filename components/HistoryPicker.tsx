"use client";
// Design Ref: §1 — 지난 날짜 보기. 날짜를 고르면 /d/YYYY-MM-DD 로 이동한다 (그 날짜 파일 1개만 읽음, AI 호출 없음).
// 최근 기록은 칩으로 보여주고, 0건·실패한 날은 누를 수 없게 상태만 표시한다.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { kstDay } from "@/lib/format";
import type { HistoryEntry } from "@/lib/types";

const STATUS_LABEL: Record<HistoryEntry["status"], string> = {
  success: "",
  empty: "0건",
  failed: "실패",
};

/** "2026-10-11" → "10.11" */
function shortDate(date: string): string {
  return `${Number(date.slice(5, 7))}.${Number(date.slice(8, 10))}`;
}

interface Props {
  /** 최근 기록 (최신이 앞). 대시보드에서만 넘긴다. */
  recent?: HistoryEntry[];
  /** 화면을 만든 시각의 한국 날짜 — 미래 날짜는 고를 수 없다 (캐시된 화면이면 브라우저에서 오늘로 다시 맞춤) */
  today: string;
  /** 기록 시작일 — 이전 날짜는 고를 수 없다 */
  min: string;
  /** 지금 보고 있는 날짜 (과거 날짜 화면) */
  current?: string;
}

export default function HistoryPicker({ recent = [], today, min, current }: Props) {
  const router = useRouter();
  const [value, setValue] = useState(current ?? "");

  return (
    <section aria-label="지난 날짜 보기" className="rounded-3xl bg-cream px-4 py-3 shadow-soft">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          // 서버도 범위 밖 날짜를 막지만(404), 고를 수 없는 날짜는 여기서 먼저 걸러 불필요한 요청을 줄인다.
          if (value && value >= min && value <= kstDay(new Date())) router.push(`/d/${value}`);
        }}
      >
        <label htmlFor="history-date" className="text-sm font-semibold text-lavender-700">
          📅 지난 날짜 보기
        </label>
        <input
          id="history-date"
          type="date"
          min={min}
          max={today}
          // 화면이 캐시돼 있어도 날짜를 고를 때는 브라우저의 오늘 날짜를 최대값으로 쓴다.
          onFocus={(event) => {
            event.currentTarget.max = kstDay(new Date());
          }}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="rounded-full border border-line bg-ivory px-3 py-1 text-sm text-ink"
        />
        <button
          type="submit"
          disabled={!value}
          className="rounded-full bg-lavender-600 px-3.5 py-1 text-sm font-semibold text-white transition-colors hover:bg-lavender-700 disabled:opacity-50"
        >
          보기
        </button>
      </form>

      {recent.length > 0 && (
        <ul className="mt-2.5 flex flex-wrap gap-1.5 text-[13px]" aria-label="최근 기록">
          {recent.map((entry) => {
            const selected = entry.date === current;
            const base = "inline-block rounded-full px-2.5 py-0.5";
            return (
              <li key={entry.date}>
                {entry.status === "success" ? (
                  <Link
                    href={`/d/${entry.date}`}
                    aria-current={selected ? "page" : undefined}
                    className={`${base} font-medium transition-colors ${
                      selected ? "bg-lavender-600 text-white" : "bg-lavender-50 text-lavender-700 hover:bg-lavender-100"
                    }`}
                  >
                    {shortDate(entry.date)} · {entry.issueCount}건
                  </Link>
                ) : (
                  <span className={`${base} bg-ivory text-ink-soft`} title="이 날은 볼 수 있는 결과가 없습니다">
                    {shortDate(entry.date)} · {STATUS_LABEL[entry.status]}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
