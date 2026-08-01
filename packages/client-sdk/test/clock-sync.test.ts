import {
  computeServerOffset,
  estimateServerTime,
  smoothOffset,
} from "@falling-platforms/client-sdk";
import { describe, expect, it } from "vitest";

describe("clock sync helpers", () => {
  it("computes the offset from the request midpoint", () => {
    expect(computeServerOffset(1000, 1100, 900)).toBe(-150);
    expect(computeServerOffset(1000, 1100, 1150)).toBe(100);
  });

  it("smooths offsets with exponential moving average", () => {
    expect(smoothOffset(null, 100)).toBe(100);
    expect(smoothOffset(100, 200)).toBeCloseTo(130);
  });

  it("estimates server time from the offset", () => {
    const before = Date.now();
    const estimate = estimateServerTime(0);
    const after = Date.now();
    expect(estimate).not.toBeNull();
    expect(estimate).toBeGreaterThanOrEqual(before);
    expect(estimate).toBeLessThanOrEqual(after);
    expect(estimateServerTime(null)).toBeNull();
  });
});
