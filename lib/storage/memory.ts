// Design Ref: §4 — 개발용 저장소. Blob 토큰 없이 로컬에서 흐름을 시험할 때만 쓴다.
// 개발 서버를 켜면 실제 AI로 한 번 실행한 결과(live-sample)로 시작한다. 배포에서는 쓰지 않는다 (lib/storage/index.ts 가 막음).
// 주의: 개발 서버에서 /api/cron 을 부르면 가짜 AI 결과("[샘플 분석]", "형식 확인용 …")로 덮인다. 개발 서버를 다시 켜면 돌아온다.
// Blob과 같은 규칙(버전이 같을 때만 쓰기)을 흉내 내, 동시 실행 방지를 로컬에서도 시험할 수 있게 한다.
import liveSample from "@/lib/ai/__fixtures__/live-sample.json";

// 자동 실행 주소와 화면이 서로 다른 묶음으로 빌드돼도 같은 값을 보도록 전역에 둔다.
const holder = globalThis as typeof globalThis & { __issueRadarStore?: { json: string; version: number } };

function store() {
  holder.__issueRadarStore ??= { json: JSON.stringify(liveSample), version: 1 };
  return holder.__issueRadarStore;
}

export class MemoryVersionConflictError extends Error {
  name = "MemoryVersionConflictError";
}

export async function readMemoryState(): Promise<{ data: unknown; version: string }> {
  const current = store();
  return { data: JSON.parse(current.json), version: String(current.version) };
}

/** 버전이 같을 때만 쓴다. 읽기와 비교·쓰기 사이에 await가 없어 한 프로세스 안에서는 원자적이다. */
export async function writeMemoryState(json: string, version: string | null): Promise<string> {
  const current = store();
  if (version !== String(current.version)) throw new MemoryVersionConflictError("다른 실행이 먼저 저장했습니다");
  current.json = json;
  current.version += 1;
  return String(current.version);
}
