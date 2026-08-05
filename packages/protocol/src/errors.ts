import { z } from "zod";

export const ERROR_CODES = [
  "INVALID_REQUEST",
  "GAME_NOT_FOUND",
  "ROOM_NOT_FOUND",
  "ROOM_EXPIRED",
  "ROOM_FULL",
  "ROOM_NOT_JOINABLE",
  "RATE_LIMITED",
  "SERVER_SHUTTING_DOWN",
  "INTERNAL_ERROR",
  "NOT_FOUND",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const errorCodeSchema = z.enum(ERROR_CODES);

export const apiErrorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

export const validationIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
});

export type ValidationIssue = z.infer<typeof validationIssueSchema>;
