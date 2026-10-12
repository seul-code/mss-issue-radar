// Design Ref: §4 — 개발용 저장소. Blob 토큰 없이 로컬에서 흐름을 시험할 때만 쓴다.
// 개발 서버를 켜면 실제 AI로 한 번 실행한 결과(live-sample)로 시작한다. 배포에서는 쓰지 않는다 (lib/storage/index.ts 가 막음).
// 주의: 개발 서버에서 /api/cron 을 부르면 가짜 AI 결과("[샘플 분석]", "형식 확인용 …")로 덮인다. 개발 서버를 다시 켜면 돌아온다.
import liveSample from "@/lib/ai/__fixtures__/live-sample.json";
import type { RadarState } from "@/lib/types";

// 자동 실행 주소와 화면이 서로 다른 묶음으로 빌드돼도 같은 값을 보도록 전역에 둔다.
const holder = globalThis as typeof globalThis & { __issueRadarState?: RadarState };

export async function readMemoryState(): Promise<RadarState> {
  holder.__issueRadarState ??= structuredClone(liveSample as RadarState);
  return structuredClone(holder.__issueRadarState);
}

export async function writeMemoryState(state: RadarState): Promise<void> {
  holder.__issueRadarState = structuredClone(state);
}
