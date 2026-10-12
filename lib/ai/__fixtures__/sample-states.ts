// Design Ref: §7 — 개발·검증용 샘플 데이터. 실제 OpenAI 호출 없이 화면과 파이프라인을 확인하는 데 쓴다.
// 제목·날짜·링크는 2026-10-06에 받은 실제 중기부 보도자료 RSS를 바탕으로 했다.
// 세부 요약은 sample-01만 실제 보도자료 본문을 바탕으로 썼고 나머지는 제목에 있는 사실만 풀어 쓴 것이며, 연관성·아이디어·확인사항은 "AI 분석" 예시 문구다.
// 언론 기사 2건(example.com 주소)은 형식 확인용으로 만든 가상 자료다.

import type { Issue, RadarState } from "@/lib/types";

/** 정상 상태에서 보여줄 이슈 12건. 중요도·분야를 고르게 섞고, 추가 확인사항이 없는 카드도 넣었다. */
export const sampleIssues: Issue[] = [
  {
    id: "sample-01",
    title: "거제‧통영 특별재난지역 소상공인‧중소기업 정책자금 금리 낮추고 상환기간 늘린다",
    publishedAt: "2026-10-06T00:16:05Z",
    sourceName: "중소벤처기업부",
    importance: "high",
    categories: ["금융", "소상공인"],
    summary: [
      "8월 호우로 특별재난지역이 된 거제·통영의 재해확인증 발급 피해기업이 대상이다.",
      "긴급경영안정자금 금리를 소상공인 2.0%→1.5%, 중소기업 1.9%→1.5%로 낮춘다.",
      "소상공인 대출한도는 최대 1억원에서 3억원으로, 상환기간은 5년에서 10년으로 늘린다.",
      "기존 정책자금 대출에는 특별만기연장을 지원한다.",
      "중소기업은 10월 1일, 소상공인은 10월 3주차부터 우대 조건이 반영된다.",
    ],
    relevance: "중기부가 직접 발표한 정책자금 조건 변경으로, 재난지역 지원 업무와 바로 연결된다.",
    ideas: [
      "다른 재난지역 지원 사례와 금리·상환기간 조건을 비교해 보고자료에 정리",
      "지역 지방중소벤처기업청과 현장 신청 현황을 공유하는 창구 점검",
    ],
    followUp: "적용 대상 업종과 신청 기간은 원문에서 확인 필요",
    sourceUrl: "https://www.mss.go.kr/site/smba/ex/bbs/View.do?cbIdx=86&bcIdx=1071601",
    // 근거 기사 목록·요약 점검 표시 확인용 (보조 기사는 example.com 가상 자료, 넷째 줄은 "수치 확인 필요" 예시)
    sources: [
      {
        url: "https://www.mss.go.kr/site/smba/ex/bbs/View.do?cbIdx=86&bcIdx=1071601",
        publisher: "중소벤처기업부",
        publishedAt: "2026-10-06T00:16:05Z",
      },
      { url: "https://example.com/news/sample-01-a", publisher: "샘플일보", publishedAt: "2026-10-06T01:20:00Z" },
    ],
    summaryEvidence: [
      { source: 0, unverifiedNumbers: [] },
      { source: 0, unverifiedNumbers: [] },
      { source: 1, unverifiedNumbers: [] },
      { source: null, unverifiedNumbers: [] },
      { source: 0, unverifiedNumbers: ["3주차"] },
    ],
  },
  {
    id: "sample-02",
    title: "온누리상품권, 전통시장·지방상권 중점으로 18년 만에 개편",
    publishedAt: "2026-09-30T23:42:43Z",
    sourceName: "중소벤처기업부",
    importance: "high",
    // 판단 근거 누락 경고 표시 확인용
    importanceReasonMissing: true,
    categories: ["전통시장", "지역경제"],
    summary: ["온누리상품권이 전통시장과 지방상권을 중심으로 18년 만에 개편된다."],
    relevance: "전통시장 지원의 핵심 수단이 바뀌는 사안으로, 관련 사업 안내 자료의 갱신이 필요하다.",
    ideas: ["개편 전후 사용처 변화를 한 장 표로 정리해 상인회 안내 자료에 활용"],
    followUp: "개편 시행 시점은 원문에서 확인 필요",
    sourceUrl: "https://www.mss.go.kr/site/smba/ex/bbs/View.do?cbIdx=86&bcIdx=1071532",
  },
  {
    id: "sample-03",
    title: "소상공인 데이터 통합·활용을 위한 「소상공인기본법」 개정안 국무회의 의결",
    publishedAt: "2026-09-22T00:32:54Z",
    sourceName: "중소벤처기업부",
    importance: "high",
    categories: ["소상공인", "디지털전환"],
    summary: ["소상공인 데이터의 통합과 활용을 위한 「소상공인기본법」 개정안이 국무회의에서 의결됐다."],
    relevance: "중기부 소관 법령 개정으로, 소상공인 데이터 관련 후속 사업 설계에 영향을 준다.",
    ideas: [
      "개정안의 데이터 통합 범위를 기존 소상공인 지원 시스템과 대조",
      "하위 법령 마련 일정을 업무 계획표에 반영",
    ],
    sourceUrl: "https://www.mss.go.kr/site/smba/ex/bbs/View.do?cbIdx=86&bcIdx=1071342",
  },
  {
    id: "sample-04",
    title: "중소기업자 우선조달 계약 범위를 확대하는 「판로지원법」 개정안 국무회의 의결",
    publishedAt: "2026-09-22T00:03:54Z",
    sourceName: "중소벤처기업부",
    importance: "high",
    categories: ["중소기업", "규제"],
    summary: ["중소기업자 우선조달 계약 범위를 넓히는 「판로지원법」 개정안이 국무회의에서 의결됐다."],
    relevance: "중소기업 공공구매 제도의 적용 범위가 바뀌어 판로 지원 업무와 직접 관련된다.",
    ideas: ["확대된 계약 범위를 공공기관 구매 담당자 대상 안내문으로 정리"],
    followUp: "시행일은 원문에서 확인 필요",
    sourceUrl: "https://www.mss.go.kr/site/smba/ex/bbs/View.do?cbIdx=86&bcIdx=1071338",
  },
  {
    id: "sample-05",
    title: "지역성장펀드 제3호, ‘대전 D-성장펀드’ 540억원 규모로 출범",
    publishedAt: "2026-10-01T04:50:05Z",
    sourceName: "중소벤처기업부",
    importance: "medium",
    categories: ["창업·벤처", "지역경제"],
    summary: ["지역성장펀드 제3호인 ‘대전 D-성장펀드’가 540억원 규모로 출범했다."],
    relevance: "지역 벤처투자 확대 흐름으로, 지역 창업기업 지원 정책과 함께 볼 수 있다.",
    ideas: [
      "1·2호 지역성장펀드와 규모·투자 분야를 비교한 표 작성",
      "대전 지역 창업기업 지원사업 안내 시 펀드 정보를 함께 제공",
    ],
    sourceUrl: "https://www.mss.go.kr/site/smba/ex/bbs/View.do?cbIdx=86&bcIdx=1071557",
  },
  {
    id: "sample-06",
    title: "중기부-금융위, 모태펀드-국민성장펀드 제2차 이어달리기 합동 밋업(Meet-Up) 개최",
    publishedAt: "2026-10-01T04:50:58Z",
    sourceName: "중소벤처기업부",
    importance: "medium",
    categories: ["금융", "창업·벤처"],
    summary: ["중소벤처기업부와 금융위원회가 모태펀드와 국민성장펀드의 제2차 이어달리기 합동 밋업을 열었다."],
    relevance: "부처 간 투자 연계 행사로, 벤처투자 협업 사례로 참고할 수 있다.",
    ideas: ["1·2차 밋업 참여 기업 특성을 정리해 후속 연계 방안 검토"],
    sourceUrl: "https://www.mss.go.kr/site/smba/ex/bbs/View.do?cbIdx=86&bcIdx=1071558",
  },
  {
    id: "sample-07",
    title: "글로벌 시장에서 K-브랜드 보호를 위한 중기부-지재처 협업 체계 가동",
    publishedAt: "2026-10-01T23:05:46Z",
    sourceName: "중소벤처기업부",
    importance: "medium",
    categories: ["수출", "중소기업"],
    summary: ["중소벤처기업부와 지식재산처가 해외 시장에서 K-브랜드를 보호하기 위한 협업 체계를 가동했다."],
    relevance: "수출 중소기업의 해외 지식재산 보호와 관련된 부처 협업이다.",
    ideas: ["수출 지원사업 참여 기업에 해외 상표 보호 안내를 함께 제공하는 방안 검토"],
    sourceUrl: "https://www.mss.go.kr/site/smba/ex/bbs/View.do?cbIdx=86&bcIdx=1071568",
  },
  {
    id: "sample-08",
    title: "혁신 창업가의 첫 투자 도전, ｢도전의 IR 프로젝트｣ 본격 가동",
    publishedAt: "2026-09-30T23:27:56Z",
    sourceName: "중소벤처기업부",
    importance: "medium",
    categories: ["창업·벤처"],
    summary: ["창업가의 첫 투자 유치를 돕는 ｢도전의 IR 프로젝트｣가 본격적으로 시작됐다."],
    relevance: "초기 창업기업 투자 연계 사업으로, 창업 지원 업무와 관련된다.",
    ideas: ["참여 창업기업 모집 일정을 창업지원 안내 채널에 공유"],
    followUp: "참여 자격 요건은 원문에서 확인 필요",
    sourceUrl: "https://www.mss.go.kr/site/smba/ex/bbs/View.do?cbIdx=86&bcIdx=1071531",
  },
  {
    id: "sample-09",
    title: "K-바이오랩허브 인천 송도에 “첫삽”, “바이오 스타트업 혁신 거점으로”",
    publishedAt: "2026-09-30T08:22:41Z",
    sourceName: "중소벤처기업부",
    importance: "medium",
    categories: ["기술혁신", "창업·벤처"],
    summary: ["K-바이오랩허브가 인천 송도에서 착공했으며, 바이오 스타트업 혁신 거점을 목표로 한다."],
    relevance: "기술창업 기반시설 사업으로, 바이오 분야 창업 지원과 관련된다.",
    ideas: ["입주 기업 모집 시점을 파악해 바이오 분야 지원사업과 연계 검토"],
    sourceUrl: "https://www.mss.go.kr/site/smba/ex/bbs/View.do?cbIdx=86&bcIdx=1071514",
  },
  {
    id: "sample-10",
    title: "공정한 벤처투자 문화를 위한 「벤처투자법」 개정안 국무회의 의결",
    publishedAt: "2026-09-22T00:02:02Z",
    sourceName: "중소벤처기업부",
    importance: "medium",
    categories: ["규제", "창업·벤처"],
    summary: ["공정한 벤처투자 문화를 위한 「벤처투자법」 개정안이 국무회의에서 의결됐다."],
    relevance: "중기부 소관 법령 개정이지만 세부 조항은 제목만으로 알 수 없다. 직접 연관된 정책은 확인 필요.",
    ideas: ["개정 조항을 확인해 벤처투자 관련 민원 응대 자료 갱신"],
    sourceUrl: "https://www.mss.go.kr/site/smba/ex/bbs/View.do?cbIdx=86&bcIdx=1071336",
  },
  {
    id: "sample-11",
    title: "[샘플] 중소 제조기업 디지털전환 설비 투자 늘어",
    publishedAt: "2026-10-05T21:30:00Z",
    sourceName: "샘플일보",
    importance: "low",
    categories: ["디지털전환", "중소기업"],
    summary: ["형식 확인용 가상 기사다. 언론 출처 카드가 어떻게 보이는지 확인하는 데 쓴다."],
    relevance: "간접적으로만 관련된 업계 동향 예시다. 직접 연관된 정책은 확인 필요.",
    ideas: ["업계 동향 자료로만 참고"],
    sourceUrl: "https://example.com/news/sample-11",
  },
  {
    id: "sample-12",
    title: "[샘플] 수출 중소기업 물류비 부담 관련 업계 간담회",
    publishedAt: "2026-10-05T09:00:00Z",
    sourceName: "샘플경제",
    importance: "low",
    categories: ["수출"],
    summary: ["형식 확인용 가상 기사다. 분야가 1개뿐이고 아이디어가 1개인 카드 예시다."],
    relevance: "수출 분야 업계 의견 예시다.",
    ideas: ["수출 지원사업 의견 수렴 자료로 참고"],
    sourceUrl: "https://example.com/news/sample-12",
  },
];

/** 결과가 만들어진 시각 (한국 시각 10/7 07:10) */
const GENERATED_AT = "2026-10-06T22:10:00Z";

/** 정상: 오늘 자동 실행이 성공해 12건을 만든 상태 */
export const normalState: RadarState = {
  lastSuccess: {
    issues: sampleIssues,
    generatedAt: GENERATED_AT,
    window: { from: "2026-10-05T22:10:00Z", to: GENERATED_AT, hours: 24 },
  },
  lastRun: { at: GENERATED_AT, status: "success", issueCount: sampleIssues.length },
};

/** 지연: 예약 실행이 오늘 돌지 않아 어제 결과를 보여주는 상태 (화면 기준 시각은 STALE_NOW) */
export const staleState: RadarState = normalState;
export const STALE_NOW = "2026-10-08T01:30:00Z";

/** 중단: 실행권을 얻은 뒤 함수가 강제 종료돼 running 기록만 남은 상태 */
export const interruptedState: RadarState = {
  lastSuccess: {
    issues: sampleIssues,
    generatedAt: "2026-10-05T22:08:00Z",
    window: { from: "2026-10-03T22:08:00Z", to: "2026-10-05T22:08:00Z", hours: 48 },
  },
  lastRun: {
    at: "2026-10-06T22:09:00Z",
    status: "running",
    issueCount: 0,
    runId: "sample-run",
    leaseUntil: "2026-10-06T22:15:00Z",
  },
};

/** 0건: 오늘은 관련 이슈가 없어 직전 결과를 계속 보여주는 상태 (주말·공휴일) */
export const emptyState: RadarState = {
  lastSuccess: { issues: sampleIssues, generatedAt: "2026-10-05T22:08:00Z" },
  lastRun: { at: "2026-10-06T22:09:00Z", status: "empty", issueCount: 0 },
};

/** 실패: 오늘 자동 실행이 실패해 직전 결과와 실패 안내를 보여주는 상태 */
export const failedState: RadarState = {
  lastSuccess: { issues: sampleIssues, generatedAt: "2026-10-05T22:08:00Z" },
  lastRun: {
    at: "2026-10-06T22:09:00Z",
    status: "failed",
    issueCount: 0,
    error: "샘플: OpenAI 응답 시간 초과",
  },
};

/** 없음: 첫 배포 직후처럼 저장된 결과가 아직 없는 상태 */
export const noneState: RadarState = {
  lastSuccess: null,
  lastRun: null,
};
