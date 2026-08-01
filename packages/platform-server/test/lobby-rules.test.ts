import { selectHost, startCommandError } from "@falling-platforms/platform-server";

import type { GameConfig } from "@falling-platforms/platform-shared";
import { describe, expect, it } from "vitest";

const config: GameConfig = {
  minPlayers: 2,
  maxPlayers: 20,
  reconnectGraceMs: 10_000,
  allowJoinAfterStart: false,
  removeDisconnectedPlayers: true,
  requiresReady: true,
};

function player(
  sessionId: string,
  connectionStatus: "connected" | "reconnecting" | "disconnected",
  joinedOrder: number,
  isReady = true,
) {
  return { sessionId, connectionStatus, joinedOrder, isReady };
}

describe("selectHost", () => {
  it("picks the earliest joined connected player", () => {
    expect(
      selectHost([
        player("a", "reconnecting", 0),
        player("b", "connected", 1),
        player("c", "connected", 2),
      ]),
    ).toBe("b");
  });

  it("falls back to the earliest remaining player when nobody is connected", () => {
    expect(
      selectHost([
        player("a", "reconnecting", 3),
        player("b", "reconnecting", 0),
        player("c", "disconnected", 1),
      ]),
    ).toBe("b");
  });

  it("returns null for an empty room", () => {
    expect(selectHost([])).toBeNull();
  });
});

describe("startCommandError", () => {
  it("rejects non-hosts", () => {
    expect(
      startCommandError(config, "lobby", "b", "a", [player("a", "connected", 0)]),
    )?.toMatchObject({ code: "NOT_HOST" });
  });

  it("rejects starts outside the lobby", () => {
    expect(
      startCommandError(config, "running", "a", "a", [player("a", "connected", 0)]),
    )?.toMatchObject({ code: "GAME_ALREADY_STARTED" });
  });

  it("rejects starts with too few connected players", () => {
    expect(
      startCommandError(config, "lobby", "a", "a", [player("a", "connected", 0)]),
    )?.toMatchObject({ code: "NOT_ENOUGH_PLAYERS" });
  });

  it("rejects starts when not everyone is ready", () => {
    expect(
      startCommandError(config, "lobby", "a", "a", [
        player("a", "connected", 0, true),
        player("b", "connected", 1, false),
      ]),
    )?.toMatchObject({ code: "PLAYERS_NOT_READY" });
  });

  it("accepts a valid start", () => {
    expect(
      startCommandError(config, "lobby", "a", "a", [
        player("a", "connected", 0, true),
        player("b", "connected", 1, true),
      ]),
    ).toBeNull();
  });

  it("ignores ready state when the game does not require it", () => {
    const noReady = { ...config, requiresReady: false };
    expect(
      startCommandError(noReady, "lobby", "a", "a", [
        player("a", "connected", 0, false),
        player("b", "connected", 1, false),
      ]),
    ).toBeNull();
  });
});
