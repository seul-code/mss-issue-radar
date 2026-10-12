// Design Ref: §4 — 개발용 저장소. Blob 토큰 없이 로컬에서 흐름을 시험할 때만 쓴다.
// 개발 서버를 켜면 실제 AI로 한 번 실행한 결과(live-sample)로 시작한다. 날짜별 기록도 그 날짜 1건으로 시작한다.
// 운영 배포(production)에서는 쓰지 않는다. 로컬·preview 는 Blob 토큰이 있어도 이 저장소만 쓴다 (lib/storage/index.ts).
// 주의: 개발 서버에서 /api/cron 을 부르면 가짜 AI 결과("[샘플 분석]", "형식 확인용 …")로 덮인다. 개발 서버를 다시 켜면 돌아온다.
// Blob과 같은 규칙(버전이 같을 때만 쓰기, 날짜별 파일은 덮어쓰기 금지)을 흉내 내, 로컬에서도 시험할 수 있게 한다.
import liveSample from "@/lib/ai/__fixtures__/live-sample.json";
import { kstDay } from "@/lib/format";

type Entry = { json: string; version: number };

// 자동 실행 주소와 화면이 서로 다른 묶음으로 빌드돼도 같은 값을 보도록 전역에 둔다.
const holder = globalThis as typeof globalThis & { __issueRadarFiles?: Map<string, Entry> };

/** 처음 쓸 때 live-sample로 최신 결과·날짜별 기록·날짜 목록을 채운다. */
function files(): Map<string, Entry> {
  if (!holder.__issueRadarFiles) {
    const map = new Map<string, Entry>();
    map.set("issue-radar/state.json", { json: JSON.stringify(liveSample), version: 1 });
    const { lastSuccess, lastRun } = liveSample;
    const date = kstDay(new Date(lastRun.at));
    const year = Number(date.slice(0, 4));
    map.set(`issue-radar/history/${date}.json`, {
      json: JSON.stringify({ date, generatedAt: lastSuccess.generatedAt, issues: lastSuccess.issues }),
      version: 1,
    });
    map.set(`issue-radar/history/index-${year}.json`, {
      json: JSON.stringify({
        year,
        entries: [{ date, status: "success", issueCount: lastSuccess.issues.length, at: lastRun.at }],
      }),
      version: 1,
    });
    holder.__issueRadarFiles = map;
  }
  return holder.__issueRadarFiles;
}

export class MemoryVersionConflictError extends Error {
  name = "MemoryVersionConflictError";
}

export class MemoryAlreadyExistsError extends Error {
  name = "MemoryAlreadyExistsError";
}

export async function readMemoryJson(pathname: string): Promise<{ data: unknown; version: string } | null> {
  const entry = files().get(pathname);
  return entry ? { data: JSON.parse(entry.json), version: String(entry.version) } : null;
}

/** 버전이 같을 때만 쓴다 (null = 파일이 없을 때만). 읽기와 비교·쓰기 사이에 await가 없어 한 프로세스 안에서는 원자적이다. */
export async function writeMemoryJsonIfVersion(pathname: string, json: string, version: string | null): Promise<string> {
  const map = files();
  const current = map.get(pathname);
  if ((current ? String(current.version) : null) !== version) {
    throw new MemoryVersionConflictError("다른 실행이 먼저 저장했습니다");
  }
  const next = (current?.version ?? 0) + 1;
  map.set(pathname, { json, version: next });
  return String(next);
}

/** 파일이 없을 때만 새로 만든다 (덮어쓰기 금지). */
export async function createMemoryJson(pathname: string, json: string): Promise<void> {
  const map = files();
  if (map.has(pathname)) throw new MemoryAlreadyExistsError("이미 같은 날짜의 기록이 있습니다");
  map.set(pathname, { json, version: 1 });
}
