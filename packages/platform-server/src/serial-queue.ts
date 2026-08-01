export interface SerialQueueOptions {
  warnDepth: number;
  warnDurationMs: number;
  logger: {
    warn(obj: unknown, message: string): void;
    error(obj: unknown, message: string): void;
  };
}

/**
 * Minimal per-room serial executor. Operations run one at a time in insertion
 * order; a failed operation is logged and does not stop the chain. The queue
 * rejects new work once disposed.
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private depthCount = 0;
  private disposed = false;

  constructor(private readonly options: SerialQueueOptions) {}

  get depth(): number {
    return this.depthCount;
  }

  enqueue<T>(task: () => T | Promise<T>): Promise<T> {
    if (this.disposed) {
      return Promise.reject(new Error("SerialQueue is disposed"));
    }
    this.depthCount += 1;
    const startedAt = performance.now();
    const run = this.tail.then(async () => {
      try {
        return await task();
      } finally {
        this.depthCount -= 1;
        const durationMs = performance.now() - startedAt;
        if (durationMs > this.options.warnDurationMs || this.depthCount > this.options.warnDepth) {
          this.options.logger.warn(
            { durationMs, depth: this.depthCount, warnDepth: this.options.warnDepth },
            "serial queue operation exceeded warning threshold",
          );
        }
      }
    });
    this.tail = run.then(
      () => undefined,
      (error: unknown) => {
        this.options.logger.error({ err: error }, "serial queue operation failed");
      },
    );
    return run;
  }

  async idle(): Promise<void> {
    await this.tail;
  }

  dispose(): void {
    this.disposed = true;
  }
}
