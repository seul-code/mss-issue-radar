// 최신 화면과 과거 날짜 화면이 함께 쓰는 머리글. 제목을 누르면 최신 결과로 돌아간다.
import Link from "next/link";
import type { ReactNode } from "react";

export default function PageHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <Link href="/" className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-12 w-12 items-center justify-center rounded-2xl bg-lavender-100 text-2xl shadow-soft"
        >
          🛰️
        </span>
        <span>
          <span className="block font-display text-[28px] leading-tight text-ink sm:text-4xl">중기부 이슈레이더</span>
          <span className="block text-sm text-ink-soft">매일 아침, 중소기업·소상공인 정책 이슈를 한눈에</span>
        </span>
      </Link>
      {children}
    </header>
  );
}
