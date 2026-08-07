import { GOLF_COURSE, golfCourseSchema } from "@phone-party/protocol";
import { describe, expect, it } from "vitest";

import { loadGolfCourse, validateGolfCourse } from "../../../src/games/golf-race/course.js";
import { buildRouteDistances, routeProjection } from "../../../src/games/golf-race/geometry.js";

describe("Golf course data", () => {
  it("parses the shared course through the validated schema", () => {
    const parsed = golfCourseSchema.parse(GOLF_COURSE);
    expect(parsed.id).toBe("arcade-loop");
    expect(parsed.world.width).toBe(1200);
    expect(parsed.startingPositions.length).toBe(8);
  });

  it("rejects malformed gate ordering", () => {
    expect(
      golfCourseSchema.safeParse({
        ...GOLF_COURSE,
        progressGates: [
          { ...GOLF_COURSE.progressGates[0], order: 1 },
          { ...GOLF_COURSE.progressGates[1], order: 0 },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects a finish line too narrow for one ball to block", () => {
    expect(() =>
      validateGolfCourse({
        ...GOLF_COURSE,
        finishLine: {
          ...GOLF_COURSE.finishLine,
          x2: GOLF_COURSE.finishLine.x1 + 20,
        },
      }),
    ).toThrow(/finish line must be wide enough/);
  });

  it("computes monotonic route distances", () => {
    const course = loadGolfCourse();
    const distances = buildRouteDistances(course);
    for (let index = 1; index < distances.length; index++) {
      expect((distances[index] ?? 0) >= (distances[index - 1] ?? 0)).toBe(true);
    }
    expect(routeProjection(course, distances, { x: 600, y: 1690 })).toBe(0);
    expect(routeProjection(course, distances, { x: 600, y: 200 })).toBe(
      distances[distances.length - 1],
    );
  });
});
