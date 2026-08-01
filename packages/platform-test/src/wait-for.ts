export async function waitFor(
  predicate: () => boolean,
  description: string,
  timeoutMs = 15_000,
  intervalMs = 20,
): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for: ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
