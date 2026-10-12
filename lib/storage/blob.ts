// Design Ref: §2 처리 5 — Vercel Blob 저장소 (무료 한도 안).
//   issue-radar/state.json               최신 결과 + 마지막 실행 기록 (조건부 덮어쓰기)
//   issue-radar/history/YYYY-MM-DD.json  성공한 날의 결과 (한 번만 쓰고 덮어쓰지 않음)
//   issue-radar/history/index-YYYY.json  연도별 날짜 목록 (조건부 덮어쓰기)
// 다른 코드는 이 파일을 직접 쓰지 않고 lib/storage/index.ts 를 거친다 (CLAUDE.md 3장).
// 저장소는 "Private"로 만든다: 주소를 알아도 토큰 없이는 열 수 없고, 아래의 캐시 우회 읽기는 Private에서만 동작한다.
// 자동 삭제(del)는 쓰지 않는다 — 과거 기록은 사용자가 직접 지우기 전까지 남는다.
import { BlobPreconditionFailedError, get, put } from "@vercel/blob";

/** 다른 실행이 먼저 파일을 바꿔 조건부 쓰기가 거절된 경우 */
export class BlobVersionConflictError extends Error {
  name = "BlobVersionConflictError";
}

/** 덮어쓰지 않는 파일이 이미 있는 경우 */
export class BlobAlreadyExistsError extends Error {
  name = "BlobAlreadyExistsError";
}

/**
 * 파일 내용(검증 전 JSON)과 버전(etag)을 읽는다. 파일이 없으면 null.
 * fresh = true 면 CDN 캐시를 거치지 않고 원본에서 읽는다 (바뀌는 파일: state·날짜 목록).
 * 날짜별 결과처럼 바뀌지 않는 파일은 캐시를 써서 읽기 작업 수를 아낀다.
 */
export async function readBlobJson(
  pathname: string,
  fresh: boolean,
  signal?: AbortSignal,
): Promise<{ data: unknown; version: string } | null> {
  const result = await get(pathname, { access: "private", useCache: !fresh, abortSignal: signal });
  if (!result || result.statusCode !== 200) return null;
  return { data: await new Response(result.stream).json(), version: result.blob.etag };
}

/**
 * 조건부로 덮어쓴다. version이 있으면 그 버전일 때만(ifMatch), null이면 파일이 아직 없을 때만 쓴다.
 * 다른 실행이 먼저 바꿨으면 BlobVersionConflictError. 성공하면 새 버전(etag)을 돌려준다.
 */
export async function writeBlobJsonIfVersion(
  pathname: string,
  json: string,
  version: string | null,
  signal?: AbortSignal,
): Promise<string> {
  try {
    const result = await put(pathname, json, {
      access: "private",
      addRandomSuffix: false,
      contentType: "application/json",
      ...(version ? { ifMatch: version } : { allowOverwrite: false }),
      abortSignal: signal,
    });
    return result.etag;
  } catch (error) {
    // 412: 다른 실행이 먼저 바꿨거나, 내 첫 저장이 성공했는데 응답이 끊겨 SDK 재시도가 거절된 경우 (호출한 쪽이 다시 읽어 확인)
    if (error instanceof BlobPreconditionFailedError) throw new BlobVersionConflictError("조건부 저장이 거절됐습니다 (버전 불일치)");
    throw error;
  }
}

/** 파일이 없을 때만 새로 만든다 (덮어쓰기 금지). 이미 있으면 BlobAlreadyExistsError. */
export async function createBlobJson(pathname: string, json: string, signal?: AbortSignal): Promise<void> {
  try {
    await put(pathname, json, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: "application/json",
      abortSignal: signal,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (error instanceof BlobPreconditionFailedError || /already exists|exists/i.test(message)) {
      throw new BlobAlreadyExistsError("이미 같은 날짜의 기록이 있습니다");
    }
    throw error;
  }
}
