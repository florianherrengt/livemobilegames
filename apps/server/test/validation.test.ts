import {
  displayNameSchema,
  joinOptionsSchema,
  roomCodeSchema,
} from "@falling-platforms/platform-shared";
import { hopCommandSchema } from "@falling-platforms/shared";
import { describe, expect, it } from "vitest";

describe("platform message validation", () => {
  it("accepts valid display names", () => {
    expect(displayNameSchema.parse("  Alice  ")).toBe("Alice");
    expect(joinOptionsSchema.parse({ name: "Bob" })).toEqual({ name: "Bob" });
  });

  it("rejects empty or overlong display names", () => {
    expect(displayNameSchema.safeParse("   ").success).toBe(false);
    expect(displayNameSchema.safeParse("x".repeat(21)).success).toBe(false);
  });

  it("normalises room codes", () => {
    expect(roomCodeSchema(5).parse(" ab3de ")).toBe("AB3DE");
  });

  it("rejects room codes with ambiguous characters", () => {
    expect(roomCodeSchema(5).safeParse("ABO0I").success).toBe(false);
    expect(roomCodeSchema(5).safeParse("AB3DE!").success).toBe(false);
  });
});

describe("falling platforms command validation", () => {
  it("accepts a valid hop command", () => {
    expect(hopCommandSchema.parse({ type: "hop", sequence: 1, targetPlatformId: "3:4" })).toEqual({
      type: "hop",
      sequence: 1,
      targetPlatformId: "3:4",
    });
  });

  it("rejects malformed hop commands", () => {
    expect(hopCommandSchema.safeParse({ sequence: 1.5, targetPlatformId: "3:4" }).success).toBe(
      false,
    );
    expect(
      hopCommandSchema.safeParse({ type: "hop", sequence: NaN, targetPlatformId: "3:4" }).success,
    ).toBe(false);
    expect(
      hopCommandSchema.safeParse({ type: "hop", sequence: 1, targetPlatformId: "3:4:5" }).success,
    ).toBe(false);
  });
});
