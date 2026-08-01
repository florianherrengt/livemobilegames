import { SerialQueue } from "@falling-platforms/platform-server";
import { describe, expect, it, vi } from "vitest";

function makeQueue(warnDepth = 20, warnDurationMs = 100) {
  const warn = vi.fn();
  const error = vi.fn();
  const queue = new SerialQueue({ warnDepth, warnDurationMs, logger: { warn, error } });
  return { queue, warn, error };
}

describe("SerialQueue", () => {
  it("preserves insertion order", async () => {
    const { queue } = makeQueue();
    const order: number[] = [];
    await Promise.all([
      queue.enqueue(async () => {
        await Promise.resolve();
        order.push(1);
      }),
      queue.enqueue(() => order.push(2)),
      queue.enqueue(() => order.push(3)),
    ]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("awaits asynchronous operations", async () => {
    const { queue } = makeQueue();
    let completed = false;
    const task = queue.enqueue(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      completed = true;
    });
    expect(completed).toBe(false);
    await task;
    expect(completed).toBe(true);
  });

  it("continues after a handled failure", async () => {
    const { queue, error } = makeQueue();
    const failing = queue.enqueue(() => {
      throw new Error("boom");
    });
    await expect(failing).rejects.toThrow("boom");
    expect(error).toHaveBeenCalled();
    await expect(queue.enqueue(() => 42)).resolves.toBe(42);
  });

  it("rejects new operations after disposal", async () => {
    const { queue } = makeQueue();
    queue.dispose();
    await expect(queue.enqueue(() => 1)).rejects.toThrow("disposed");
  });

  it("exposes an idle promise", async () => {
    const { queue } = makeQueue();
    queue.enqueue(() => Promise.resolve());
    queue.enqueue(() => Promise.resolve());
    await queue.idle();
    expect(queue.depth).toBe(0);
  });

  it("warns on slow operations and excessive depth", async () => {
    const { queue, warn } = makeQueue(1, 0);
    const slow = queue.enqueue(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    queue.enqueue(() => undefined);
    await slow;
    await queue.idle();
    expect(warn).toHaveBeenCalled();
  });
});
