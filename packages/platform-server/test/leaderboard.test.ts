import { buildLeaderboard, validateMatchResult } from "@falling-platforms/platform-server";
import { describe, expect, it } from "vitest";

describe("buildLeaderboard", () => {
  it("ranks ties with standard competition ranking", () => {
    const result = buildLeaderboard(
      [
        { sessionId: "a", primaryScore: 10, label: "A" },
        { sessionId: "b", primaryScore: 10, label: "B" },
        { sessionId: "c", primaryScore: 7, label: "C" },
        { sessionId: "d", primaryScore: 2, label: "D" },
      ],
      123,
    );
    expect(result.winnerSessionIds).toEqual(["a", "b"]);
    expect(result.leaderboard.map((entry) => entry.rank)).toEqual([1, 1, 3, 4]);
    expect(result.finishedAt).toBe(123);
  });

  it("breaks score ties deterministically by session id for ordering", () => {
    const result = buildLeaderboard(
      [
        { sessionId: "z", primaryScore: 5, label: "Z" },
        { sessionId: "a", primaryScore: 5, label: "A" },
      ],
      1,
    );
    expect(result.leaderboard.map((entry) => entry.sessionId)).toEqual(["a", "z"]);
  });
});

describe("validateMatchResult", () => {
  it("accepts a valid result", () => {
    const result = buildLeaderboard([{ sessionId: "a", primaryScore: 1, label: "A" }], 1);
    expect(validateMatchResult(result, new Set(["a"]))).toBeNull();
  });

  it("rejects leaderboard players outside the room", () => {
    const result = buildLeaderboard([{ sessionId: "ghost", primaryScore: 1, label: "Ghost" }], 1);
    expect(validateMatchResult(result, new Set(["a"]))).toMatchObject({
      code: "INVALID_REQUEST",
    });
  });

  it("rejects winners missing from the leaderboard", () => {
    const result = buildLeaderboard([{ sessionId: "a", primaryScore: 1, label: "A" }], 1);
    const invalid = { ...result, winnerSessionIds: ["nobody"] };
    expect(validateMatchResult(invalid, new Set(["a"]))).toMatchObject({
      code: "INVALID_REQUEST",
    });
  });
});
