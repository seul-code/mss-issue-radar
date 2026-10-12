// Design Ref: §2 처리 5 — Vercel Blob 저장소 (무료 한도 안). 파일 1개에 RadarState 전체를 담는다.
// 다른 코드는 이 파일을 직접 쓰지 않고 lib/storage/index.ts 를 거친다 (CLAUDE.md 3장).
// 저장소는 "Private"로 만든다: 주소를 알아도 토큰 없이는 열 수 없고, 아래의 캐시 우회 읽기는 Private에서만 동작한다.
import { BlobPreconditionFailedError, get, put } from "@vercel/blob";

/** 고정된 파일 이름. 실행할 때마다 같은 파일을 덮어쓴다. */
const PATHNAME = "issue-radar/state.json";

/** 다른 실행이 먼저 파일을 바꿔 조건부 쓰기가 거절된 경우 */
export class BlobVersionConflictError extends Error {
  name = "BlobVersionConflictError";
}

/**
 * 저장된 내용(검증 전 JSON)과 버전(etag)을 읽는다. 파일이 아직 없으면(첫 배포 직후) null.
 * 덮어쓴 직후에도 최신 내용을 읽도록 CDN 캐시를 거치지 않고 원본에서 읽는다 (Design §9 Blob 지연 문제).
 */
export async function readBlobState(): Promise<{ data: unknown; version: string } | null> {
  const result = await get(PATHNAME, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) return null;
  return { data: await new Response(result.stream).json(), version: result.blob.etag };
}

/**
 * 조건부로 덮어쓴다. version이 있으면 그 버전일 때만(ifMatch), null이면 파일이 아직 없을 때만 쓴다.
 * 다른 실행이 먼저 바꿨으면 BlobVersionConflictError. 성공하면 새 버전(etag)을 돌려준다.
 */
export async function writeBlobState(json: string, version: string | null): Promise<string> {
  try {
    const result = await put(PATHNAME, json, {
      access: "private",
      addRandomSuffix: false,
      contentType: "application/json",
      ...(version ? { ifMatch: version } : { allowOverwrite: false }),
    });
    return result.etag;
  } catch (error) {
    if (error instanceof BlobPreconditionFailedError) throw new BlobVersionConflictError("다른 실행이 먼저 저장했습니다");
    throw error;
  }
}
