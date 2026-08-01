import {
  commandResultPayloadSchema,
  displayNameSchema,
  gameConfigSchema,
  joinOptionsSchema,
  matchResultSchema,
  roomCodeSchema,
  setReadySchema,
  storedConnectionSchema,
  timeSyncRequestSchema,
} from "@falling-platforms/platform-shared";
import { describe, expect, it } from "vitest";

describe("display name schema", () => {
  it("trims and stores the normalised value", () => {
    expect(displayNameSchema.parse("  Alice  ")).toBe("Alice");
  });

  it("rejects empty names", () => {
    expect(displayNameSchema.safeParse("   ").success).toBe(false);
  });

  it("rejects overlong names", () => {
    expect(displayNameSchema.safeParse("x".repeat(21)).success).toBe(false);
  });

  it("rejects control characters", () => {
    expect(displayNameSchema.safeParse("A\u0000B").success).toBe(false);
    expect(displayNameSchema.safeParse("A\nB").success).toBe(false);
  });
});

describe("room code schema", () => {
  const schema = roomCodeSchema(5);

  it("normalises case and whitespace", () => {
    expect(schema.parse(" ab3de ")).toBe("AB3DE");
  });

  it("rejects ambiguous characters", () => {
    expect(schema.safeParse("ABO0I").success).toBe(false);
    expect(schema.safeParse("AB3D1").success).toBe(false);
  });

  it("rejects the wrong length", () => {
    expect(schema.safeParse("ABCDE6").success).toBe(false);
    expect(schema.safeParse("ABCD").success).toBe(false);
  });

  it("supports configurable lengths", () => {
    expect(roomCodeSchema(6).parse("ABCDEF")).toBe("ABCDEF");
  });
});

describe("join options", () => {
  it("accepts a valid name", () => {
    expect(joinOptionsSchema.parse({ name: "Bob" })).toEqual({ name: "Bob" });
  });

  it("rejects unknown fields", () => {
    expect(joinOptionsSchema.safeParse({ name: "Bob", extra: 1 }).success).toBe(false);
  });
});

describe("lobby command schemas", () => {
  it("requires request ids", () => {
    expect(setReadySchema.safeParse({ ready: true }).success).toBe(false);
    expect(setReadySchema.parse({ ready: true, requestId: "req-1" })).toEqual({
      ready: true,
      requestId: "req-1",
    });
  });

  it("validates time sync requests", () => {
    expect(timeSyncRequestSchema.parse({ requestId: "req-1", sentAt: 1000 })).toEqual({
      requestId: "req-1",
      sentAt: 1000,
    });
    expect(timeSyncRequestSchema.safeParse({ requestId: "req-1", sentAt: NaN }).success).toBe(
      false,
    );
  });
});

describe("command result schema", () => {
  it("parses success and failure payloads", () => {
    expect(
      commandResultPayloadSchema.parse({
        requestId: "req-1",
        operation: "room.start",
        ok: true,
      }),
    ).toMatchObject({ ok: true });
    expect(
      commandResultPayloadSchema.parse({
        requestId: "req-1",
        operation: "room.start",
        ok: false,
        error: { code: "NOT_HOST", message: "nope" },
      }),
    ).toMatchObject({ ok: false });
  });
});

describe("game config schema", () => {
  const valid = {
    minPlayers: 2,
    maxPlayers: 20,
    reconnectGraceMs: 10_000,
    allowJoinAfterStart: false,
    removeDisconnectedPlayers: true,
    requiresReady: true,
  };

  it("accepts a valid config", () => {
    expect(gameConfigSchema.parse(valid)).toEqual(valid);
  });

  it("rejects minPlayers below one", () => {
    expect(gameConfigSchema.safeParse({ ...valid, minPlayers: 0 }).success).toBe(false);
  });

  it("rejects maxPlayers below minPlayers", () => {
    expect(gameConfigSchema.safeParse({ ...valid, maxPlayers: 1 }).success).toBe(false);
  });

  it("rejects negative reconnect grace", () => {
    expect(gameConfigSchema.safeParse({ ...valid, reconnectGraceMs: -1 }).success).toBe(false);
  });
});

describe("match result schema", () => {
  it("rejects leaderboard entries with rank below one", () => {
    expect(
      matchResultSchema.safeParse({
        winnerSessionIds: [],
        leaderboard: [{ sessionId: "a", rank: 0, primaryScore: 1, label: "A" }],
        finishedAt: 1,
      }).success,
    ).toBe(false);
  });

  it("accepts ties and metadata", () => {
    expect(
      matchResultSchema.parse({
        winnerSessionIds: ["a", "b"],
        leaderboard: [
          { sessionId: "a", rank: 1, primaryScore: 5, label: "A" },
          { sessionId: "b", rank: 1, primaryScore: 5, label: "B" },
        ],
        finishedAt: 1,
        metadata: { round: 2 },
      }).winnerSessionIds,
    ).toEqual(["a", "b"]);
  });
});

describe("stored connection schema", () => {
  it("accepts a valid record", () => {
    expect(
      storedConnectionSchema.parse({
        serverUrl: "ws://localhost:2567",
        roomId: "ABCDE",
        roomName: "tap_race",
        reconnectToken: "secret-token",
        updatedAt: 123,
      }).reconnectToken,
    ).toBe("secret-token");
  });

  it("rejects missing fields", () => {
    expect(storedConnectionSchema.safeParse({ roomId: "ABCDE" }).success).toBe(false);
  });
});
