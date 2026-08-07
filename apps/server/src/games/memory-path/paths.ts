import { MEMORY_PATH_CONSTANTS, type MemoryPathDifficulty } from "@phone-party/protocol";

import {
  distanceBetweenSegments,
  distanceToPolyline,
  type Point2D,
  pathTotalLength,
  segmentsIntersect,
} from "./geometry.js";

export interface MemoryPathLandmark {
  readonly id: string;
  readonly shape: "circle" | "square" | "triangle";
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly color: string;
}

export interface PathTemplate {
  readonly id: string;
  readonly difficulty: MemoryPathDifficulty;
  readonly points: readonly Point2D[];
}

const START: Point2D = { x: MEMORY_PATH_CONSTANTS.START_X, y: MEMORY_PATH_CONSTANTS.START_Y };
const FINISH: Point2D = { x: MEMORY_PATH_CONSTANTS.FINISH_X, y: MEMORY_PATH_CONSTANTS.FINISH_Y };

function reflectX(points: readonly Point2D[]): readonly Point2D[] {
  return points.map((point) => ({
    x: MEMORY_PATH_CONSTANTS.WORLD_WIDTH - point.x,
    y: point.y,
  }));
}

function makePath(
  id: string,
  difficulty: MemoryPathDifficulty,
  points: readonly Point2D[],
): PathTemplate {
  return Object.freeze({
    id,
    difficulty,
    points: Object.freeze(points.map((point) => Object.freeze({ ...point }))),
  });
}

function withReflections(
  difficulty: MemoryPathDifficulty,
  bases: readonly (readonly Point2D[])[],
): PathTemplate[] {
  const templates: PathTemplate[] = [];
  bases.forEach((points, index) => {
    const id = `${difficulty}-${index + 1}`;
    templates.push(makePath(id, difficulty, points));
    templates.push(makePath(`${id}-mirror`, difficulty, reflectX(points)));
  });
  return templates;
}

// Every route starts at the bottom-centre start area, ends at the top-centre
// finish area, and stays inside the safe playable band between x=90..300 and
// y=140..700 so the fixed landmark ring never overlaps the corridor.
const EASY_ROUTES = withReflections("easy", [
  [
    { x: 195, y: 700 },
    { x: 110, y: 700 },
    { x: 110, y: 540 },
    { x: 300, y: 540 },
    { x: 300, y: 350 },
    { x: 150, y: 350 },
    { x: 150, y: 190 },
    { x: 195, y: 140 },
  ],
  [
    { x: 195, y: 700 },
    { x: 195, y: 570 },
    { x: 95, y: 570 },
    { x: 95, y: 420 },
    { x: 300, y: 420 },
    { x: 300, y: 260 },
    { x: 170, y: 260 },
    { x: 170, y: 180 },
    { x: 195, y: 140 },
  ],
  [
    { x: 195, y: 700 },
    { x: 195, y: 590 },
    { x: 110, y: 590 },
    { x: 110, y: 450 },
    { x: 290, y: 450 },
    { x: 290, y: 300 },
    { x: 150, y: 300 },
    { x: 150, y: 190 },
    { x: 195, y: 140 },
  ],
  [
    { x: 195, y: 700 },
    { x: 195, y: 590 },
    { x: 105, y: 590 },
    { x: 105, y: 440 },
    { x: 295, y: 440 },
    { x: 295, y: 290 },
    { x: 160, y: 290 },
    { x: 160, y: 180 },
    { x: 195, y: 140 },
  ],
]);

const MEDIUM_ROUTES = withReflections("medium", [
  [
    { x: 195, y: 700 },
    { x: 195, y: 620 },
    { x: 95, y: 620 },
    { x: 95, y: 480 },
    { x: 300, y: 480 },
    { x: 300, y: 330 },
    { x: 120, y: 330 },
    { x: 120, y: 200 },
    { x: 275, y: 200 },
    { x: 275, y: 150 },
    { x: 195, y: 140 },
  ],
  [
    { x: 195, y: 700 },
    { x: 285, y: 700 },
    { x: 285, y: 550 },
    { x: 100, y: 550 },
    { x: 100, y: 410 },
    { x: 300, y: 410 },
    { x: 300, y: 270 },
    { x: 130, y: 270 },
    { x: 130, y: 180 },
    { x: 260, y: 180 },
    { x: 195, y: 140 },
  ],
  [
    { x: 195, y: 700 },
    { x: 195, y: 610 },
    { x: 100, y: 610 },
    { x: 100, y: 460 },
    { x: 295, y: 460 },
    { x: 295, y: 310 },
    { x: 110, y: 310 },
    { x: 110, y: 200 },
    { x: 285, y: 200 },
    { x: 285, y: 160 },
    { x: 195, y: 140 },
  ],
  [
    { x: 195, y: 700 },
    { x: 195, y: 650 },
    { x: 100, y: 650 },
    { x: 100, y: 520 },
    { x: 300, y: 520 },
    { x: 300, y: 370 },
    { x: 120, y: 370 },
    { x: 120, y: 240 },
    { x: 285, y: 240 },
    { x: 285, y: 170 },
    { x: 195, y: 140 },
  ],
]);

const HARD_ROUTES = withReflections("hard", [
  [
    { x: 195, y: 700 },
    { x: 195, y: 640 },
    { x: 100, y: 640 },
    { x: 100, y: 510 },
    { x: 300, y: 510 },
    { x: 300, y: 370 },
    { x: 115, y: 370 },
    { x: 115, y: 240 },
    { x: 290, y: 240 },
    { x: 290, y: 170 },
    { x: 195, y: 140 },
  ],
  [
    { x: 195, y: 700 },
    { x: 290, y: 700 },
    { x: 290, y: 560 },
    { x: 95, y: 560 },
    { x: 95, y: 430 },
    { x: 300, y: 430 },
    { x: 300, y: 300 },
    { x: 110, y: 300 },
    { x: 110, y: 190 },
    { x: 280, y: 190 },
    { x: 195, y: 140 },
  ],
  [
    { x: 195, y: 700 },
    { x: 195, y: 630 },
    { x: 105, y: 630 },
    { x: 105, y: 500 },
    { x: 300, y: 500 },
    { x: 300, y: 360 },
    { x: 120, y: 360 },
    { x: 120, y: 230 },
    { x: 290, y: 230 },
    { x: 290, y: 150 },
    { x: 195, y: 140 },
  ],
  [
    { x: 195, y: 700 },
    { x: 195, y: 650 },
    { x: 100, y: 650 },
    { x: 100, y: 520 },
    { x: 300, y: 520 },
    { x: 300, y: 380 },
    { x: 115, y: 380 },
    { x: 115, y: 250 },
    { x: 295, y: 250 },
    { x: 295, y: 160 },
    { x: 195, y: 140 },
  ],
  [
    { x: 195, y: 700 },
    { x: 285, y: 700 },
    { x: 285, y: 570 },
    { x: 100, y: 570 },
    { x: 100, y: 440 },
    { x: 300, y: 440 },
    { x: 300, y: 310 },
    { x: 120, y: 310 },
    { x: 120, y: 210 },
    { x: 275, y: 210 },
    { x: 275, y: 160 },
    { x: 195, y: 140 },
  ],
]);

export const PATH_TEMPLATES: readonly PathTemplate[] = Object.freeze([
  ...EASY_ROUTES,
  ...MEDIUM_ROUTES,
  ...HARD_ROUTES,
]);

export const ROUTES_BY_DIFFICULTY: Readonly<Record<MemoryPathDifficulty, readonly PathTemplate[]>> =
  Object.freeze({
    easy: Object.freeze(EASY_ROUTES),
    medium: Object.freeze(MEDIUM_ROUTES),
    hard: Object.freeze(HARD_ROUTES),
  });

/**
 * Fixed landmark ring around the playable band. Every route stays far enough
 * from these positions that no landmark covers the corridor; landmarks remain
 * visible while the path is hidden so players can anchor spatial memory.
 */
export const LANDMARKS: readonly MemoryPathLandmark[] = Object.freeze([
  Object.freeze({ id: "circle-tl", shape: "circle", x: 32, y: 180, size: 14, color: "#e63946" }),
  Object.freeze({ id: "square-tr", shape: "square", x: 358, y: 220, size: 16, color: "#457b9d" }),
  Object.freeze({
    id: "triangle-ml",
    shape: "triangle",
    x: 32,
    y: 360,
    size: 16,
    color: "#2a9d8f",
  }),
  Object.freeze({ id: "circle-mr", shape: "circle", x: 358, y: 420, size: 14, color: "#f4a261" }),
  Object.freeze({ id: "square-bl", shape: "square", x: 32, y: 540, size: 16, color: "#9b5de5" }),
  Object.freeze({
    id: "triangle-br",
    shape: "triangle",
    x: 358,
    y: 600,
    size: 16,
    color: "#f15bb5",
  }),
  Object.freeze({ id: "circle-bl", shape: "circle", x: 32, y: 680, size: 14, color: "#00bbf9" }),
  Object.freeze({ id: "square-br", shape: "square", x: 358, y: 700, size: 16, color: "#fee440" }),
]);

const DIFFICULTY_LENGTH_RANGE: Readonly<Record<MemoryPathDifficulty, [number, number]>> = {
  easy: [700, 1_200],
  medium: [900, 1_450],
  hard: [1_050, 1_550],
};

function directionChanges(points: readonly Point2D[]): number {
  let changes = 0;
  let previous: { x: number; y: number } | null = null;
  for (let index = 0; index < points.length - 1; index++) {
    const start = points[index];
    const end = points[index + 1];
    if (!start || !end) {
      continue;
    }
    const dx = Math.sign(end.x - start.x);
    const dy = Math.sign(end.y - start.y);
    if (dx === 0 && dy === 0) {
      continue;
    }
    if (previous !== null && (dx !== previous.x || dy !== previous.y)) {
      changes += 1;
    }
    previous = { x: dx, y: dy };
  }
  return changes;
}

/**
 * Validates a path template against the route rules: continuous, single
 * non-self-crossing corridor, start/finish placement, playable bounds,
 * navigable segment lengths, difficulty-appropriate length and turns, and
 * landmark clearance. Throws with the route id so invalid data fails loudly
 * during development instead of producing a broken round.
 */
export function validatePathTemplate(template: PathTemplate): void {
  const { points } = template;
  if (points.length < 4) {
    throw new Error(`Route ${template.id} needs at least four points`);
  }
  if (points[0]?.x !== START.x || points[0]?.y !== START.y) {
    throw new Error(`Route ${template.id} must start in the start area`);
  }
  const last = points[points.length - 1];
  if (last?.x !== FINISH.x || last?.y !== FINISH.y) {
    throw new Error(`Route ${template.id} must end in the finish area`);
  }

  const width = pathWidthForDifficulty(template.difficulty);
  for (const point of points) {
    if (point.x < MEMORY_PATH_CONSTANTS.PLAY_AREA_LEFT + 20) {
      throw new Error(`Route ${template.id} leaves the left playable edge`);
    }
    if (point.x > MEMORY_PATH_CONSTANTS.PLAY_AREA_RIGHT - 20) {
      throw new Error(`Route ${template.id} leaves the right playable edge`);
    }
    if (point.y < MEMORY_PATH_CONSTANTS.PLAY_AREA_TOP + 20) {
      throw new Error(`Route ${template.id} leaves the top playable edge`);
    }
    if (point.y > MEMORY_PATH_CONSTANTS.PLAY_AREA_BOTTOM - 20) {
      throw new Error(`Route ${template.id} leaves the bottom playable edge`);
    }
  }

  for (let index = 0; index < points.length - 1; index++) {
    const start = points[index];
    const end = points[index + 1];
    if (!start || !end) {
      continue;
    }
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length < 40) {
      throw new Error(`Route ${template.id} has an unnavigable short segment at ${index}`);
    }
  }

  for (let first = 0; first < points.length - 1; first++) {
    const a = points[first];
    const b = points[first + 1];
    for (let second = first + 1; second < points.length - 1; second++) {
      const c = points[second];
      const d = points[second + 1];
      if (!a || !b || !c || !d) {
        continue;
      }
      // Adjacent segments and segments separated by one connector share the
      // same corridor through the turn; only unrelated sections must keep a
      // safe distance.
      if (second <= first + 2) {
        continue;
      }
      if (segmentsIntersect(a, b, c, d)) {
        throw new Error(`Route ${template.id} crosses itself`);
      }
      const minimumSeparation = Math.max(64, width + 32);
      if (distanceBetweenSegments(a, b, c, d) < minimumSeparation) {
        throw new Error(`Route ${template.id} has sections that come too close`);
      }
    }
  }

  const totalLength = pathTotalLength(points);
  const [minLength, maxLength] = DIFFICULTY_LENGTH_RANGE[template.difficulty];
  if (totalLength < minLength || totalLength > maxLength) {
    throw new Error(
      `Route ${template.id} length ${totalLength} is outside the ${template.difficulty} range`,
    );
  }
  if (directionChanges(points) < 4) {
    throw new Error(`Route ${template.id} is too straight to be a memory route`);
  }

  for (const landmark of LANDMARKS) {
    const clearance = width / 2 + landmark.size + 14;
    if (distanceToPolyline({ x: landmark.x, y: landmark.y }, points) < clearance) {
      throw new Error(`Route ${template.id} overlaps landmark ${landmark.id}`);
    }
  }
}

export function pathWidthForDifficulty(difficulty: MemoryPathDifficulty): number {
  if (difficulty === "easy") {
    return MEMORY_PATH_CONSTANTS.EASY_PATH_WIDTH;
  }
  if (difficulty === "medium") {
    return MEMORY_PATH_CONSTANTS.MEDIUM_PATH_WIDTH;
  }
  return MEMORY_PATH_CONSTANTS.HARD_PATH_WIDTH;
}

export function routeForDifficulty(
  difficulty: MemoryPathDifficulty,
  usedRouteIds: ReadonlySet<string>,
  rng: () => number,
): PathTemplate {
  const pool = ROUTES_BY_DIFFICULTY[difficulty];
  const available = pool.filter((route) => !usedRouteIds.has(route.id));
  if (available.length === 0) {
    throw new Error(`No unused ${difficulty} route available`);
  }
  const index = Math.min(available.length - 1, Math.floor(rng() * available.length));
  const selected = available[index];
  if (!selected) {
    throw new Error(`No unused ${difficulty} route available`);
  }
  return selected;
}

export function validateAllPathTemplates(): void {
  for (const template of PATH_TEMPLATES) {
    validatePathTemplate(template);
  }
}

validateAllPathTemplates();
