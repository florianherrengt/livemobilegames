import { createRoomCodeGenerator, ROOM_CODE_ALPHABET } from "@falling-platforms/platform-shared";

export interface RoomCodePresence {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown> | unknown;
  del(key: string): void | Promise<void>;
}

export interface RoomCodeAllocatorOptions {
  alphabet?: string;
  length: number;
  maxAttempts?: number;
  claimTtlMs: number;
}

/**
 * Allocates unique human-readable room codes through the Colyseus Presence
 * API. Claiming uses the atomic `incr` counter (1 means first claim), sets a
 * safety TTL, and releases with `del`. Works with in-memory Presence and is
 * compatible with Redis Presence.
 */
export class RoomCodeAllocator {
  private readonly generate: () => string;
  private readonly maxAttempts: number;

  constructor(
    private readonly presence: RoomCodePresence,
    private readonly options: RoomCodeAllocatorOptions,
  ) {
    this.generate = createRoomCodeGenerator({
      alphabet: options.alphabet ?? ROOM_CODE_ALPHABET,
      length: options.length,
    });
    this.maxAttempts = options.maxAttempts ?? 100;
  }

  private keyFor(code: string): string {
    return `room_codes:${code}`;
  }

  async claim(): Promise<string> {
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      const code = this.generate();
      const count = await this.presence.incr(this.keyFor(code));
      if (count === 1) {
        await this.presence.expire(
          this.keyFor(code),
          Math.max(1, Math.ceil(this.options.claimTtlMs / 1000)),
        );
        return code;
      }
    }
    throw new Error("Unable to allocate a unique room code");
  }

  async release(code: string): Promise<void> {
    await this.presence.del(this.keyFor(code));
  }
}
