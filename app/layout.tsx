// Design Ref: §1 — 모든 화면이 공유하는 틀. 한국어 문서, 한글 글꼴, 서비스 제목을 정한다.
import type { Metadata } from "next";
import { Noto_Sans_KR } from "next/font/google";
import "./globals.css";

// 한글 글꼴을 앱에 내장한다. 한글 글자는 필요한 부분만 나눠서 내려받는다.
const notoSansKr = Noto_Sans_KR({
  variable: "--font-noto-sans-kr",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "중기부 이슈레이더",
  description: "중소벤처기업부 관련 뉴스·정책 이슈를 매일 아침 한 화면에 정리합니다.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={`${notoSansKr.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
