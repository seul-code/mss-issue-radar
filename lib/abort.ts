/**
 * 호출 하나의 제한 시간과 자동 실행 전체의 취소 신호 중 먼저 끝나는 쪽에서 멈추는 신호.
 * 전체 시간 예산(lib/pipeline.ts)이 끝나면 대기 중인 수집·AI 호출이 함께 멈춘다.
 */
export function timeoutSignal(ms: number, parent?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}
