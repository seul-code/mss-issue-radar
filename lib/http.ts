// 외부 응답 크기 제한 (2026-10-12 공개 전 보안 점검). 수집기·OpenAI 호출이 함께 쓴다.
// 아주 큰 응답이 오면 메모리를 많이 쓰고 정규식 처리가 오래 걸려 그날 실행 전체가 시간 초과로 실패할 수 있다.
// - Content-Length 머리글이 한도를 넘으면 본문을 받지 않고 바로 멈춘다.
// - 머리글이 없거나 틀릴 수 있으므로, 실제로 받은 바이트를 세다가 한도를 넘는 순간 받기를 멈춘다.
// 넘으면 ResponseTooLargeError 를 던진다. 출처마다 따로 잡히므로 한 출처의 초과가 전체 수집을 멈추지 않는다.

export class ResponseTooLargeError extends Error {
  name = "ResponseTooLargeError";
}

/** 응답 본문을 최대 maxBytes 바이트까지만 읽어 글자(UTF-8)로 돌려준다. */
export async function readTextLimited(res: Response, maxBytes: number, label: string): Promise<string> {
  const limitText = `${Math.round(maxBytes / 1024)}KB`;
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new ResponseTooLargeError(`${label} 응답이 너무 큽니다 (머리글 ${Math.round(declared / 1024)}KB > ${limitText})`);
  }
  if (!res.body) return "";

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new ResponseTooLargeError(`${label} 응답이 너무 큽니다 (받은 크기 ${limitText} 초과)`);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(bytes);
}
