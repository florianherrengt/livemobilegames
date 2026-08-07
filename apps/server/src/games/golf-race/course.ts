import { GOLF_COURSE, type GolfCourse, golfCourseSchema } from "@phone-party/protocol";

import { GOLF_SERVER_CONSTANTS } from "./constants.js";

/**
 * Validates the shared course data at server startup and returns the parsed
 * immutable course. New courses are data in the protocol package; the server
 * never executes course logic from arbitrary input.
 */
export function loadGolfCourse(): GolfCourse {
  const course = golfCourseSchema.parse(GOLF_COURSE);
  validateGolfCourse(course);
  return course;
}

export function validateGolfCourse(course: GolfCourse): void {
  const radius = GOLF_SERVER_CONSTANTS.BALL_RADIUS;
  const insideWorld = (x: number, y: number): boolean =>
    x >= radius &&
    x <= course.world.width - radius &&
    y >= radius &&
    y <= course.world.height - radius;

  for (const position of [...course.startingPositions, ...course.respawnPositions]) {
    if (!insideWorld(position.x, position.y)) {
      throw new Error(
        `Golf course ${course.id}: position ${JSON.stringify(position)} is outside the world`,
      );
    }
  }
  for (const gate of course.progressGates) {
    if (!insideWorld(gate.x1, gate.y1) || !insideWorld(gate.x2, gate.y2)) {
      throw new Error(`Golf course ${course.id}: progress gate ${gate.id} is outside the world`);
    }
  }
  if (
    !insideWorld(course.finishLine.x1, course.finishLine.y1) ||
    !insideWorld(course.finishLine.x2, course.finishLine.y2)
  ) {
    throw new Error(`Golf course ${course.id}: finish line is outside the world`);
  }
  for (const point of course.route) {
    if (!insideWorld(point.x, point.y)) {
      throw new Error(
        `Golf course ${course.id}: route point ${JSON.stringify(point)} is outside the world`,
      );
    }
  }
  for (const position of course.startingPositions) {
    if (course.hazards.some((hazard) => pointInsideHazard(position, hazard))) {
      throw new Error(
        `Golf course ${course.id}: starting position ${JSON.stringify(position)} is inside a hazard`,
      );
    }
    if (
      course.walls.some((wall) => distanceToSegment(position, wall) < radius) ||
      course.obstacles.some((obstacle) => distanceToObstacle(position, obstacle) < radius)
    ) {
      throw new Error(
        `Golf course ${course.id}: starting position ${JSON.stringify(position)} overlaps geometry`,
      );
    }
  }
  const finishLength = Math.hypot(
    course.finishLine.x2 - course.finishLine.x1,
    course.finishLine.y2 - course.finishLine.y1,
  );
  if (finishLength < GOLF_SERVER_CONSTANTS.BALL_RADIUS * 8) {
    throw new Error(
      `Golf course ${course.id}: finish line must be wide enough that one ball cannot block it`,
    );
  }
  for (let index = 0; index < course.startingPositions.length; index++) {
    for (let other = index + 1; other < course.startingPositions.length; other++) {
      const a = course.startingPositions[index];
      const b = course.startingPositions[other];
      if (a && b && Math.hypot(a.x - b.x, a.y - b.y) < radius * 2) {
        throw new Error(`Golf course ${course.id}: starting positions overlap`);
      }
    }
  }
  for (const position of course.respawnPositions) {
    if (course.hazards.some((hazard) => pointInsideHazard(position, hazard))) {
      throw new Error(
        `Golf course ${course.id}: respawn position ${JSON.stringify(position)} is inside a hazard`,
      );
    }
    if (
      course.walls.some((wall) => distanceToSegment(position, wall) < radius) ||
      course.obstacles.some((obstacle) => distanceToObstacle(position, obstacle) < radius)
    ) {
      throw new Error(
        `Golf course ${course.id}: respawn position ${JSON.stringify(position)} overlaps geometry`,
      );
    }
  }
}

export function pointInsideHazard(
  point: { x: number; y: number },
  hazard: GolfCourse["hazards"][number],
): boolean {
  if (hazard.kind === "rect") {
    return (
      point.x >= hazard.x &&
      point.x <= hazard.x + hazard.width &&
      point.y >= hazard.y &&
      point.y <= hazard.y + hazard.height
    );
  }
  const dx = point.x - hazard.x;
  const dy = point.y - hazard.y;
  return dx * dx + dy * dy <= hazard.radius * hazard.radius;
}

function distanceToSegment(
  point: { x: number; y: number },
  segment: { x1: number; y1: number; x2: number; y2: number },
): number {
  const dx = segment.x2 - segment.x1;
  const dy = segment.y2 - segment.y1;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point.x - segment.x1) * dx + (point.y - segment.y1) * dy) / lengthSquared),
        );
  const closestX = segment.x1 + t * dx;
  const closestY = segment.y1 + t * dy;
  return Math.hypot(point.x - closestX, point.y - closestY);
}

function distanceToObstacle(
  point: { x: number; y: number },
  obstacle: GolfCourse["obstacles"][number],
): number {
  if (obstacle.kind === "circle") {
    return Math.max(0, Math.hypot(point.x - obstacle.x, point.y - obstacle.y) - obstacle.radius);
  }
  const closestX = Math.max(obstacle.x, Math.min(point.x, obstacle.x + obstacle.width));
  const closestY = Math.max(obstacle.y, Math.min(point.y, obstacle.y + obstacle.height));
  return Math.hypot(point.x - closestX, point.y - closestY);
}
