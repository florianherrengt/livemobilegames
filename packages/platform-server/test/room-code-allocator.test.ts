import { RoomCodeAllocator } from "@falling-platforms/platform-server";

import { ROOM_CODE_ALPHABET } from "@falling-platforms/platform-shared";
import { describe, expect, it } from "vitest";

class FakePresence {
  counters = new Map<string, number>();
  expires = new Map<string, number>();
  deleted = new Set<string>();
  collideOnce = new Set<string>();
  collideAlways = new Set<string>();

  async incr(key: string): Promise<number> {
    const current = this.counters.get(key) ?? 0;
    if (this.collideAlways.has(key)) {
      this.counters.set(key, Math.max(2, current + 1));
      return this.counters.get(key) ?? 2;
    }
    if (this.collideOnce.has(key) && current === 0) {
      this.collideOnce.delete(key);
      return 2;
    }
    const next = current + 1;
    this.counters.set(key, next);
    return next;
  }

  async expire(key: string, seconds: number): Promise<void> {
    this.expires.set(key, seconds);
  }

  async del(key: string): Promise<void> {
    this.deleted.add(key);
  }
}

describe("RoomCodeAllocator", () => {
  it("claims a code of the requested length from the allowed alphabet", async () => {
    const presence = new FakePresence();
    const allocator = new RoomCodeAllocator(presence, { length: 6, claimTtlMs: 1000 });
    const code = await allocator.claim();
    expect(code).toHaveLength(6);
    for (const char of code) {
      expect(ROOM_CODE_ALPHABET).toContain(char);
    }
  });

  it("sets a TTL on the claim", async () => {
    const presence = new FakePresence();
    const allocator = new RoomCodeAllocator(presence, {
      alphabet: "A",
      length: 5,
      claimTtlMs: 2500,
    });
    const code = await allocator.claim();
    expect(presence.expires.get(`room_codes:${code}`)).toBe(3);
  });

  it("retries on collision", async () => {
    const presence = new FakePresence();
    presence.collideOnce.add("room_codes:AAAAA");
    const allocator = new RoomCodeAllocator(presence, {
      alphabet: "A",
      length: 5,
      maxAttempts: 5,
      claimTtlMs: 1000,
    });
    await expect(allocator.claim()).resolves.toBe("AAAAA");
  });

  it("gives up after exhausting attempts", async () => {
    const presence = new FakePresence();
    presence.collideAlways.add("room_codes:AAAAA");
    const allocator = new RoomCodeAllocator(presence, {
      alphabet: "A",
      length: 5,
      maxAttempts: 3,
      claimTtlMs: 1000,
    });
    await expect(allocator.claim()).rejects.toThrow("Unable to allocate");
  });

  it("releases the claim", async () => {
    const presence = new FakePresence();
    const allocator = new RoomCodeAllocator(presence, {
      alphabet: "A",
      length: 5,
      claimTtlMs: 1000,
    });
    const code = await allocator.claim();
    await allocator.release(code);
    expect(presence.deleted.has(`room_codes:${code}`)).toBe(true);
  });
});
