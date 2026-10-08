// Design Ref: §2 처리 5 — Vercel Blob 저장소 (무료 한도 안). 파일 1개에 RadarState 전체를 담는다.
// 다른 코드는 이 파일을 직접 쓰지 않고 lib/storage/index.ts 를 거친다 (CLAUDE.md 3장).
import { get, put } from "@vercel/blob";
import type { RadarState } from "@/lib/types";

/** 고정된 파일 이름. 실행할 때마다 같은 파일을 덮어쓴다. */
const PATHNAME = "issue-radar/state.json";

/**
 * 저장된 상태를 읽는다. 파일이 아직 없으면(첫 배포 직후) null.
 * 덮어쓴 직후에도 최신 내용을 읽도록 CDN 캐시를 거치지 않고 원본에서 읽는다 (Design §9 Blob 지연 문제).
 */
export async function readBlobState(): Promise<RadarState | null> {
  const result = await get(PATHNAME, { access: "public", useCache: false });
  if (!result || result.statusCode !== 200) return null;
  return (await new Response(result.stream).json()) as RadarState;
}

/** 상태 전체를 덮어쓴다. */
export async function writeBlobState(state: RadarState): Promise<void> {
  await put(PATHNAME, JSON.stringify(state), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}
