import type { GolfCourse } from "@phone-party/protocol";

import type { GolfServerConstants } from "./constants.js";
import { pointInsideHazard } from "./course.js";
import { type Point, segmentIntersection } from "./geometry.js";
import type { RuntimePlayer } from "./types.js";

export function pointInsideHazardForPlacement(
  point: Point,
  course: GolfCourse,
  radius: number,
): boolean {
  return course.hazards.some((hazard) => {
    if (hazard.kind === "rect") {
      return (
        point.x >= hazard.x - radius &&
        point.x <= hazard.x + hazard.width + radius &&
        point.y >= hazard.y - radius &&
        point.y <= hazard.y + hazard.height + radius
      );
    }
    return Math.hypot(point.x - hazard.x, point.y - hazard.y) <= hazard.radius + radius;
  });
}

function collideWall(player: RuntimePlayer, config: GolfServerConstants, course: GolfCourse): void {
  const radius = config.BALL_RADIUS;
  for (const wall of course.walls) {
    const closest = closestPointOnSegment({ x: player.x, y: player.y }, wall);
    const dx = player.x - closest.x;
    const dy = player.y - closest.y;
    const distance = Math.hypot(dx, dy);
    if (distance >= radius || distance === 0) {
      continue;
    }
    const nx = dx / distance;
    const ny = dy / distance;
    player.x = closest.x + nx * radius;
    player.y = closest.y + ny * radius;
    const vn = player.vx * nx + player.vy * ny;
    if (vn < 0) {
      const impulse = -(1 + config.WALL_RESTITUTION) * vn;
      player.vx += impulse * nx;
      player.vy += impulse * ny;
    }
  }
}

function collideObstacle(
  player: RuntimePlayer,
  config: GolfServerConstants,
  obstacle: GolfCourse["obstacles"][number],
): void {
  const radius = config.BALL_RADIUS;
  let closest: Point;
  let normalX: number;
  let normalY: number;
  if (obstacle.kind === "circle") {
    const dx = player.x - obstacle.x;
    const dy = player.y - obstacle.y;
    const distance = Math.hypot(dx, dy) || 1;
    normalX = dx / distance;
    normalY = dy / distance;
    closest = {
      x: obstacle.x + normalX * obstacle.radius,
      y: obstacle.y + normalY * obstacle.radius,
    };
  } else {
    const closestX = Math.max(obstacle.x, Math.min(player.x, obstacle.x + obstacle.width));
    const closestY = Math.max(obstacle.y, Math.min(player.y, obstacle.y + obstacle.height));
    closest = { x: closestX, y: closestY };
    const dx = player.x - closest.x;
    const dy = player.y - closest.y;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) {
      normalX = player.x <= obstacle.x ? -1 : 1;
      normalY = player.y <= obstacle.y ? -1 : 1;
    } else {
      normalX = dx / distance;
      normalY = dy / distance;
    }
  }
  const dx = player.x - closest.x;
  const dy = player.y - closest.y;
  const distance = Math.hypot(dx, dy);
  if (distance >= radius) {
    return;
  }
  const normalLength = Math.hypot(normalX, normalY) || 1;
  const nx = normalX / normalLength;
  const ny = normalY / normalLength;
  player.x = closest.x + nx * radius;
  player.y = closest.y + ny * radius;
  const vn = player.vx * nx + player.vy * ny;
  if (vn < 0) {
    const impulse = -(1 + config.WALL_RESTITUTION) * vn;
    player.vx += impulse * nx;
    player.vy += impulse * ny;
  }
}

function collideBallPair(a: RuntimePlayer, b: RuntimePlayer, config: GolfServerConstants): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy);
  const minimum = config.BALL_RADIUS * 2;
  if (distance >= minimum) {
    return;
  }
  const nx = distance === 0 ? 1 : dx / distance;
  const ny = distance === 0 ? 0 : dy / distance;
  const overlap = (minimum - distance) / 2;
  a.x -= nx * overlap;
  a.y -= ny * overlap;
  b.x += nx * overlap;
  b.y += ny * overlap;
  const relativeVn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (relativeVn < 0) {
    const impulse = (-(1 + config.BALL_RESTITUTION) * relativeVn) / 2;
    a.vx -= impulse * nx;
    a.vy -= impulse * ny;
    b.vx += impulse * nx;
    b.vy += impulse * ny;
  }
}

export function stepPhysics(
  players: ReadonlyMap<string, RuntimePlayer>,
  course: GolfCourse,
  config: GolfServerConstants,
  dtSeconds: number,
  isCollisionImmune: (player: RuntimePlayer) => boolean,
): void {
  const active = [...players.values()].filter((player) => !player.removed && !player.finished);
  const damping = Math.exp(-config.DAMPING_PER_SECOND * dtSeconds);
  for (const player of active) {
    player.vx *= damping;
    player.vy *= damping;
    player.x += player.vx * dtSeconds;
    player.y += player.vy * dtSeconds;
  }

  for (let iteration = 0; iteration < 4; iteration++) {
    for (const player of active) {
      collideWall(player, config, course);
      for (const obstacle of course.obstacles) {
        collideObstacle(player, config, obstacle);
      }
    }
    for (let index = 0; index < active.length; index++) {
      for (let other = index + 1; other < active.length; other++) {
        const a = active[index];
        const b = active[other];
        if (a && b && !isCollisionImmune(a) && !isCollisionImmune(b)) {
          collideBallPair(a, b, config);
        }
      }
    }
  }
}

export function speedOf(player: RuntimePlayer): number {
  return Math.hypot(player.vx, player.vy);
}

export function closestPointOnSegment(
  point: Point,
  segment: { x1: number; y1: number; x2: number; y2: number },
): Point {
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
  return { x: segment.x1 + t * dx, y: segment.y1 + t * dy };
}

export function isInsideHazard(point: Point, hazard: GolfCourse["hazards"][number]): boolean {
  return pointInsideHazard(point, hazard);
}

export function crossesSegment(
  from: Point,
  to: Point,
  segment: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    validDirectionX?: number;
    validDirectionY?: number;
  },
  validDirection?: { x: number; y: number },
): { point: Point; t: number } | null {
  const intersection = segmentIntersection(
    from,
    to,
    { x: segment.x1, y: segment.y1 },
    { x: segment.x2, y: segment.y2 },
  );
  if (!intersection) {
    return null;
  }
  if (validDirection) {
    const movementX = to.x - from.x;
    const movementY = to.y - from.y;
    if (movementX * validDirection.x + movementY * validDirection.y <= 0) {
      return null;
    }
  }
  return { point: intersection.point, t: intersection.t };
}
