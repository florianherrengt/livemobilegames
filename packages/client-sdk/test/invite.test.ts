import { buildInviteUrl } from "@falling-platforms/client-sdk";
import { describe, expect, it } from "vitest";

describe("buildInviteUrl", () => {
  it("replaces existing query parameters with the room code", () => {
    expect(buildInviteUrl("abcde", "https://games.example/falling-platforms/?name=Alice#top")).toBe(
      "https://games.example/falling-platforms/?code=ABCDE",
    );
  });

  it("preserves the path used by dev servers", () => {
    expect(buildInviteUrl("ABCDE", "http://localhost:5173/?name=Alice")).toBe(
      "http://localhost:5173/?code=ABCDE",
    );
  });

  it("normalises lowercase codes", () => {
    expect(buildInviteUrl("a1b2c", "http://localhost:5173/")).toBe(
      "http://localhost:5173/?code=A1B2C",
    );
  });
});
