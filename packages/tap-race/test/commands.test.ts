import { tapRaceCommandSchema } from "@falling-platforms/tap-race";
import { describe, expect, it } from "vitest";

describe("Tap Race commands", () => {
  it("accepts a tap command", () => {
    expect(tapRaceCommandSchema.parse({ type: "tap" })).toEqual({ type: "tap" });
  });

  it("rejects unknown commands", () => {
    expect(tapRaceCommandSchema.safeParse({ type: "jump" }).success).toBe(false);
    expect(tapRaceCommandSchema.safeParse({ type: "tap", score: 100 }).success).toBe(false);
  });
});
