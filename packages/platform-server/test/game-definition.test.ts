import type { MapSchema } from "@colyseus/schema";
import { PlatformPlayerState, PlatformState } from "@falling-platforms/platform-schema";
import { assertValidGameDefinition, type GameDefinition } from "@falling-platforms/platform-server";
import { describe, expect, it } from "vitest";
import { z } from "zod";

class FixtureState extends PlatformState {
  declare players: MapSchema<PlatformPlayerState>;
}

const base = {
  id: "game",
  config: {
    minPlayers: 1,
    maxPlayers: 4,
    reconnectGraceMs: 1000,
    allowJoinAfterStart: false,
    removeDisconnectedPlayers: true,
    requiresReady: true,
  },
  commandSchema: z.object({ type: z.literal("x") }),
  createState: () => new FixtureState(),
  createPlayerState: () => new PlatformPlayerState(),
  onCommand: () => undefined,
} satisfies GameDefinition<FixtureState, PlatformPlayerState, { type: "x" }>;

describe("assertValidGameDefinition", () => {
  it("accepts a valid definition", () => {
    expect(assertValidGameDefinition(base)).toBeNull();
  });

  it("rejects an empty game id", () => {
    expect(assertValidGameDefinition({ ...base, id: " " })).toMatchObject({
      code: "INVALID_REQUEST",
    });
  });

  it("rejects an invalid configuration", () => {
    expect(
      assertValidGameDefinition({
        ...base,
        config: { ...base.config, maxPlayers: 0 },
      }),
    ).toMatchObject({ code: "INVALID_REQUEST" });
  });
});
