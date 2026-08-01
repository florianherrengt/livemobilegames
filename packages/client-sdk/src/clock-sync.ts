/**
 * Server clock offset estimation based on a typed time-sync exchange.
 * offset = serverTime - (sentAt + receivedAt) / 2
 */
export function computeServerOffset(
  sentAt: number,
  receivedAt: number,
  serverTime: number,
): number {
  return serverTime - (sentAt + receivedAt) / 2;
}

export function smoothOffset(previous: number | null, sample: number, alpha = 0.3): number {
  return previous === null ? sample : previous * (1 - alpha) + sample * alpha;
}

export function estimateServerTime(offset: number | null): number | null {
  return offset === null ? null : Date.now() + offset;
}
