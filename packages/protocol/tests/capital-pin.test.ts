import { describe, expect, it } from "vitest";

import {
  CapitalPinState,
  capitalPinCommandSchema,
  capitalPinSubmitSchema,
  roomErrorPayloadSchema,
  roomTransitionSchema,
  startGameRequestSchema,
} from "../src/index.js";

describe("capital pin submit command", () => {
  it("accepts a valid submit intent", () => {
    const result = capitalPinSubmitSchema.safeParse({
      type: "submit",
      roundNumber: 1,
      latitude: 48.85,
      longitude: 2.35,
    });
    expect(result.success).toBe(true);
  });

  it("rejects coordinate bounds and non-finite values", () => {
    const invalid = [
      { type: "submit", roundNumber: 1, latitude: 91, longitude: 0 },
      { type: "submit", roundNumber: 1, latitude: 0, longitude: -181 },
      { type: "submit", roundNumber: 1, latitude: Number.NaN, longitude: 0 },
      { type: "submit", roundNumber: 1, latitude: 0, longitude: Number.POSITIVE_INFINITY },
      { type: "submit", roundNumber: 0, latitude: 0, longitude: 0 },
      { type: "submit", roundNumber: 1.5, latitude: 0, longitude: 0 },
    ];
    for (const payload of invalid) {
      expect(capitalPinSubmitSchema.safeParse(payload).success).toBe(false);
    }
  });

  it("rejects unknown fields on submit commands", () => {
    const result = capitalPinSubmitSchema.safeParse({
      type: "submit",
      roundNumber: 1,
      latitude: 0,
      longitude: 0,
      sessionId: "forged-session",
      distanceKm: 1,
    });
    expect(result.success).toBe(false);
  });

  it("discriminates the command union by type", () => {
    expect(capitalPinCommandSchema.safeParse({ type: "unknown" }).success).toBe(false);
    expect(
      capitalPinCommandSchema.safeParse({
        type: "submit",
        roundNumber: 2,
        latitude: -33.9,
        longitude: 151.2,
      }).success,
    ).toBe(true);
  });
});

describe("start game request", () => {
  it("accepts an empty payload", () => {
    expect(startGameRequestSchema.safeParse({}).success).toBe(true);
  });

  it("rejects unknown fields", () => {
    expect(startGameRequestSchema.safeParse({ gameId: "capital-pin" }).success).toBe(false);
  });
});

describe("room transition payload", () => {
  it("accepts a server-issued reservation", () => {
    const result = roomTransitionSchema.safeParse({
      gameId: "capital-pin",
      roomCode: "ABC234",
      reservation: {
        name: "capital-pin-room",
        sessionId: "session-1",
        roomId: "room-1",
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects malformed transitions", () => {
    expect(roomTransitionSchema.safeParse({ gameId: "capital-pin" }).success).toBe(false);
    expect(
      roomTransitionSchema.safeParse({
        gameId: "capital-pin",
        roomCode: "ABC234",
        reservation: { name: "", sessionId: "", roomId: "" },
      }).success,
    ).toBe(false);
  });
});

describe("room error payload", () => {
  it("accepts a stable error code and safe message", () => {
    const result = roomErrorPayloadSchema.safeParse({
      code: "NOT_ENOUGH_PLAYERS",
      message: "At least 2 connected players are required",
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown codes and empty messages", () => {
    expect(roomErrorPayloadSchema.safeParse({ code: "MADE_UP", message: "x" }).success).toBe(false);
    expect(roomErrorPayloadSchema.safeParse({ code: "NOT_HOST", message: " " }).success).toBe(
      false,
    );
  });
});

describe("capital pin synchronized state", () => {
  it("initialises with safe public defaults", () => {
    const state = new CapitalPinState();
    expect(state.phase).toBe("lobby");
    expect(state.roomCode).toBe("");
    expect(state.currentCapitalName).toBe("");
    expect(state.roundEndsAt).toBe(0);
    expect(state.resultsEndsAt).toBe(0);
    expect(state.lastResult).toBeNull();
    expect(state.result).toBeNull();
    expect(state.players.size).toBe(0);
    expect(state.roundNumber).toBe(0);
    expect(state.totalRounds).toBe(0);
  });
});
