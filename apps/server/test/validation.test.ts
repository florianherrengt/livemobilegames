import {
  displayNameSchema,
  hopRequestSchema,
  joinOptionsSchema,
  roomCodeSchema,
  startMatchSchema,
} from "@falling-platforms/shared";
import { describe, expect, it } from "vitest";

describe("message validation", () => {
  it("accepts valid display names", () => {
    expect(displayNameSchema.parse("  Alice  ")).toBe("Alice");
    expect(joinOptionsSchema.parse({ name: "Bob" })).toEqual({ name: "Bob" });
  });

  it("rejects empty or overlong display names", () => {
    expect(displayNameSchema.safeParse("   ").success).toBe(false);
    expect(displayNameSchema.safeParse("x".repeat(21)).success).toBe(false);
  });

  it("normalises room codes", () => {
    expect(roomCodeSchema.parse(" ab3de ")).toBe("AB3DE");
  });

  it("rejects room codes with ambiguous characters", () => {
    expect(roomCodeSchema.safeParse("ABO0I").success).toBe(false);
    expect(roomCodeSchema.safeParse("AB3DE!").success).toBe(false);
  });

  it("rejects malformed hop requests", () => {
    expect(hopRequestSchema.safeParse({ sequence: 1.5, targetPlatformId: "3:4" }).success).toBe(
      false,
    );
    expect(
      hopRequestSchema.safeParse({ sequence: Number.NaN, targetPlatformId: "3:4" }).success,
    ).toBe(false);
    expect(
      hopRequestSchema.safeParse({ sequence: Number.POSITIVE_INFINITY, targetPlatformId: "3:4" })
        .success,
    ).toBe(false);
    expect(hopRequestSchema.safeParse({ sequence: 1, targetPlatformId: "nope" }).success).toBe(
      false,
    );
    expect(hopRequestSchema.safeParse({ sequence: 1 }).success).toBe(false);
    expect(
      hopRequestSchema.safeParse({ sequence: 1, targetPlatformId: "3:4", source: "3:3" }).success,
    ).toBe(false);
  });

  it("accepts valid hop requests", () => {
    expect(hopRequestSchema.parse({ sequence: 7, targetPlatformId: "3:4" })).toEqual({
      sequence: 7,
      targetPlatformId: "3:4",
    });
  });

  it("accepts empty start requests", () => {
    expect(startMatchSchema.parse({})).toEqual({});
  });
});
