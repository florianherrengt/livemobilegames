import { z } from "zod";

/**
 * Validated, data-driven course model. The first version supports the
 * primitives the initial course needs: outer walls, static segments,
 * rectangular/circular obstacles and hazards, fixed starts and respawns,
 * ordered progress gates, a route used for progress measurement, and one
 * finish line. New courses are added as data, not executable code.
 */

export const golfPointSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
  })
  .strict();

export type GolfPoint = z.infer<typeof golfPointSchema>;

export const golfSegmentSchema = z
  .object({
    x1: z.number().finite(),
    y1: z.number().finite(),
    x2: z.number().finite(),
    y2: z.number().finite(),
  })
  .strict();

export type GolfSegment = z.infer<typeof golfSegmentSchema>;

export const golfRectSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
  })
  .strict();

export type GolfRect = z.infer<typeof golfRectSchema>;

export const golfCircleSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    radius: z.number().finite().positive(),
  })
  .strict();

export type GolfCircle = z.infer<typeof golfCircleSchema>;

export const golfObstacleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("rect"), ...golfRectSchema.shape }).strict(),
  z.object({ kind: z.literal("circle"), ...golfCircleSchema.shape }).strict(),
]);

export type GolfObstacle = z.infer<typeof golfObstacleSchema>;

export const golfHazardSchema = golfObstacleSchema;

export type GolfHazard = z.infer<typeof golfHazardSchema>;

export const golfRespawnSchema = z
  .object({
    id: z.string().trim().min(1).max(50),
    x: z.number().finite(),
    y: z.number().finite(),
    /** Number of progress gates that must be crossed before this respawn unlocks. */
    unlockedAfterGateCount: z.number().int().min(0),
  })
  .strict();

export type GolfRespawn = z.infer<typeof golfRespawnSchema>;

export const golfProgressGateSchema = z
  .object({
    id: z.string().trim().min(1).max(50),
    order: z.number().int().min(0),
    x1: z.number().finite(),
    y1: z.number().finite(),
    x2: z.number().finite(),
    y2: z.number().finite(),
    validDirectionX: z.number().finite(),
    validDirectionY: z.number().finite(),
  })
  .strict();

export type GolfProgressGate = z.infer<typeof golfProgressGateSchema>;

export const golfFinishLineSchema = golfSegmentSchema
  .extend({
    validDirectionX: z.number().finite(),
    validDirectionY: z.number().finite(),
  })
  .strict();

export type GolfFinishLine = z.infer<typeof golfFinishLineSchema>;

export const golfWorldSchema = z
  .object({
    width: z.number().int().min(200).max(20_000),
    height: z.number().int().min(200).max(20_000),
  })
  .strict();

export type GolfWorld = z.infer<typeof golfWorldSchema>;

export const golfCourseSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().trim().min(1).max(50),
    name: z.string().trim().min(1).max(80),
    world: golfWorldSchema,
    startingPositions: z.array(golfPointSchema).min(1).max(8),
    respawnPositions: z.array(golfRespawnSchema).min(1),
    progressGates: z
      .array(golfProgressGateSchema)
      .min(1)
      .refine(
        (gates) =>
          gates.every((gate, index) => gate.order === index) &&
          new Set(gates.map((gate) => gate.id)).size === gates.length,
        { message: "Progress gates must have unique ids and contiguous order from 0" },
      ),
    finishLine: golfFinishLineSchema,
    route: z.array(golfPointSchema).min(2),
    walls: z.array(golfSegmentSchema),
    obstacles: z.array(golfObstacleSchema),
    hazards: z.array(golfHazardSchema),
  })
  .strict();

export type GolfCourse = z.infer<typeof golfCourseSchema>;

/**
 * The initial course: an upward S-shaped track with a narrow hazard crossing,
 * a funnel into a narrow passage, obstacles, angled bank walls, four ordered
 * progress gates and a final finish line. The route is the stable course
 * measure used to compare players on curved sections.
 */
export const GOLF_COURSE: GolfCourse = golfCourseSchema.parse({
  schemaVersion: 1,
  id: "arcade-loop",
  name: "Arcade Loop",
  world: { width: 1200, height: 1800 },
  startingPositions: [
    { x: 360, y: 1690 },
    { x: 450, y: 1690 },
    { x: 540, y: 1690 },
    { x: 630, y: 1690 },
    { x: 720, y: 1690 },
    { x: 810, y: 1690 },
    { x: 900, y: 1690 },
    { x: 990, y: 1690 },
  ],
  respawnPositions: [
    { id: "start", x: 600, y: 1680, unlockedAfterGateCount: 0 },
    { id: "mid", x: 600, y: 1280, unlockedAfterGateCount: 2 },
    { id: "top", x: 600, y: 560, unlockedAfterGateCount: 4 },
  ],
  progressGates: [
    {
      id: "gate-0",
      order: 0,
      x1: 120,
      y1: 1330,
      x2: 1080,
      y2: 1330,
      validDirectionX: 0,
      validDirectionY: -1,
    },
    {
      id: "gate-1",
      order: 1,
      x1: 120,
      y1: 1010,
      x2: 1080,
      y2: 1010,
      validDirectionX: 0,
      validDirectionY: -1,
    },
    {
      id: "gate-2",
      order: 2,
      x1: 120,
      y1: 620,
      x2: 1080,
      y2: 620,
      validDirectionX: 0,
      validDirectionY: -1,
    },
    {
      id: "gate-3",
      order: 3,
      x1: 120,
      y1: 340,
      x2: 1080,
      y2: 340,
      validDirectionX: 0,
      validDirectionY: -1,
    },
    {
      id: "gate-4",
      order: 4,
      x1: 120,
      y1: 260,
      x2: 1080,
      y2: 260,
      validDirectionX: 0,
      validDirectionY: -1,
    },
  ],
  finishLine: {
    x1: 120,
    y1: 200,
    x2: 1080,
    y2: 200,
    validDirectionX: 0,
    validDirectionY: -1,
  },
  route: [
    { x: 600, y: 1690 },
    { x: 600, y: 1470 },
    { x: 600, y: 1330 },
    { x: 600, y: 1280 },
    { x: 600, y: 1120 },
    { x: 600, y: 1010 },
    { x: 600, y: 900 },
    { x: 600, y: 700 },
    { x: 600, y: 620 },
    { x: 600, y: 400 },
    { x: 600, y: 340 },
    { x: 600, y: 260 },
    { x: 600, y: 200 },
  ],
  walls: [
    { x1: 40, y1: 100, x2: 40, y2: 1760 },
    { x1: 1160, y1: 100, x2: 1160, y2: 1760 },
    { x1: 40, y1: 1760, x2: 1160, y2: 1760 },
    { x1: 40, y1: 100, x2: 1160, y2: 100 },
    { x1: 120, y1: 1050, x2: 480, y2: 1050 },
    { x1: 720, y1: 1050, x2: 1080, y2: 1050 },
    { x1: 160, y1: 520, x2: 300, y2: 360 },
    { x1: 900, y1: 360, x2: 1040, y2: 520 },
  ],
  obstacles: [
    { kind: "rect", x: 250, y: 700, width: 160, height: 140 },
    { kind: "circle", x: 900, y: 650, radius: 100 },
  ],
  hazards: [
    { kind: "rect", x: 120, y: 1160, width: 410, height: 120 },
    { kind: "rect", x: 670, y: 1160, width: 410, height: 120 },
    { kind: "circle", x: 940, y: 240, radius: 70 },
  ],
});
