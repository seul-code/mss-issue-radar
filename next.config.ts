import type { NextConfig } from "next";

// 모든 응답에 붙이는 보안 머리글 (2026-10-12 공개 전 보안 점검).
// 화면에 상태를 바꾸는 버튼이 없어 위험은 낮지만, 공개 전에 기본 방어를 켠다.
const SECURITY_HEADERS = [
  // 다른 사이트가 이 화면을 틀(iframe) 안에 넣어 보여주지 못하게 한다 (옛 브라우저용 + 표준)
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  // 브라우저가 파일 종류를 멋대로 추측해 실행하지 않게 한다
  { key: "X-Content-Type-Options", value: "nosniff" },
  // 원문 링크로 나갈 때 이 사이트의 전체 주소를 넘기지 않는다
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // 검색엔진 색인 방지 (app/layout.tsx 의 robots 설정과 같은 내용, HTML 이 아닌 응답에도 적용)
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

const nextConfig: NextConfig = {
  // 응답에 "X-Powered-By: Next.js" 를 붙이지 않는다 (프레임워크 정보 노출 줄이기)
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
