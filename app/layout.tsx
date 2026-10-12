// Design Ref: §1 — 모든 화면이 공유하는 틀. 한국어 문서, 글꼴(본문 Pretendard · 제목 Jua), 서비스 제목을 정한다.
import type { Metadata } from "next";
import { Jua } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

// 본문 글꼴: Pretendard (SIL OFL 1.1, app/fonts/Pretendard-LICENSE.txt). 앱에 파일로 넣어 외부 접속 없이 쓴다.
const pretendard = localFont({
  src: "./fonts/PretendardVariable.woff2",
  variable: "--font-pretendard",
  weight: "45 920",
  display: "swap",
});

// 제목·숫자 글꼴: Jua (Google Fonts, 빌드할 때 앱에 내장됨)
const jua = Jua({
  variable: "--font-jua",
  weight: "400",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "중기부 이슈레이더",
  description: "중소벤처기업부 관련 뉴스·정책 이슈를 매일 아침 한 화면에 정리합니다.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={`${pretendard.variable} ${jua.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
