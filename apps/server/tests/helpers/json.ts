export function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected a JSON object");
  }
  return value as Record<string, unknown>;
}

export function parsePlayerId(value: unknown): string {
  const record = asRecord(value);
  if (typeof record.playerId !== "string" || !/^[0-9a-f-]{36}$/.test(record.playerId)) {
    throw new Error("Expected a playerId in the response");
  }
  return record.playerId;
}
