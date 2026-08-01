import { Decoder, Encoder } from "@colyseus/schema";
import {
  LeaderboardEntryState,
  MatchResultState,
  matchResultToState,
  PlatformState,
  stateToMatchResult,
} from "@falling-platforms/platform-schema";
import { describe, expect, it } from "vitest";
import { GamePlayerState, GameState } from "../src/test-fixtures.js";

describe("platform schema classes", () => {
  it("round-trips platform state through the schema encoder", () => {
    const state = new GameState();
    state.roomCode = "ABC12";
    state.gameId = "tap_race";
    state.status = "running";
    state.hostSessionId = "s1";
    state.createdAt = 1234;
    state.minPlayers = 2;
    state.requiresReady = true;

    const player = new GamePlayerState();
    player.name = "Alice";
    player.connectionStatus = "connected";
    player.isHost = true;
    player.isReady = true;
    player.joinedAt = 100;
    player.joinedOrder = 0;
    state.players.set("s1", player);

    const encoder = new Encoder(state);
    const bytes = encoder.encodeAll();
    const decoded = new GameState();
    new Decoder(decoded, encoder.context).decode(bytes);

    expect(decoded.roomCode).toBe("ABC12");
    expect(decoded.status).toBe("running");
    expect(decoded.players.get("s1")?.name).toBe("Alice");
    expect(decoded.players.get("s1")?.isReady).toBe(true);
  });

  it("round-trips a nullable match result", () => {
    const state = new PlatformState();
    state.result = matchResultToState({
      winnerSessionIds: ["s1"],
      leaderboard: [
        { sessionId: "s1", rank: 1, primaryScore: 7, label: "Alice", secondaryLabel: "7 taps" },
        { sessionId: "s2", rank: 2, primaryScore: 3, label: "Bob" },
      ],
      finishedAt: 9876,
    });

    const encoder = new Encoder(state);
    const bytes = encoder.encodeAll();
    const decoded = new PlatformState();
    new Decoder(decoded, encoder.context).decode(bytes);

    const result = stateToMatchResult(decoded.result);
    expect(result?.winnerSessionIds).toEqual(["s1"]);
    expect(result?.leaderboard[1]).toMatchObject({ sessionId: "s2", rank: 2, primaryScore: 3 });
    expect(result?.leaderboard[1]?.secondaryLabel).toBeUndefined();

    state.result = null;
    const nullEncoder = new Encoder(state);
    const nullBytes = nullEncoder.encodeAll();
    const nullDecoded = new PlatformState();
    new Decoder(nullDecoded, nullEncoder.context).decode(nullBytes);
    expect(nullDecoded.result).toBeNull();
  });

  it("keeps game subclass fields when the game declares its own players map", () => {
    const state = new GameState();
    const player = new GamePlayerState();
    player.name = "Alice";
    player.alive = true;
    state.players.set("s1", player);

    const encoder = new Encoder(state);
    const bytes = encoder.encodeAll();
    const decoded = new GameState();
    new Decoder(decoded, encoder.context).decode(bytes);

    const decodedPlayer = decoded.players.get("s1");
    expect(decodedPlayer).toBeInstanceOf(GamePlayerState);
    expect(decodedPlayer?.name).toBe("Alice");
    expect(decodedPlayer?.alive).toBe(true);
  });

  it("produces plain result data from schema state", () => {
    const resultState = new MatchResultState();
    resultState.finishedAt = 5;
    resultState.winnerSessionIds.push("s1");
    const entry = new LeaderboardEntryState();
    entry.sessionId = "s1";
    entry.rank = 1;
    entry.primaryScore = 2;
    entry.label = "Alice";
    resultState.leaderboard.push(entry);

    expect(stateToMatchResult(resultState)).toEqual({
      winnerSessionIds: ["s1"],
      leaderboard: [{ sessionId: "s1", rank: 1, primaryScore: 2, label: "Alice" }],
      finishedAt: 5,
    });
  });
});
