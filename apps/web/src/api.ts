import {
  type ApiError,
  apiErrorSchema,
  type CreateRoomRequest,
  type CreateRoomResponse,
  createRoomRequestSchema,
  createRoomResponseSchema,
  type GamesResponse,
  gamesResponseSchema,
  type JoinRoomRequest,
  type JoinRoomResponse,
  joinRoomRequestSchema,
  joinRoomResponseSchema,
} from "@phone-party/protocol";
import type { z } from "zod";

export class ApiClientError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

export function apiErrorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiClientError ? error.message : fallback;
}

async function request<T>(path: string, options: RequestInit, schema: z.ZodType<T>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, options);
  } catch {
    throw new ApiClientError("NETWORK_ERROR", "Could not reach the server");
  }

  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const error = apiErrorSchema.safeParse(body);
    if (error.success) {
      const apiError: ApiError = error.data;
      throw new ApiClientError(apiError.error.code, apiError.error.message, apiError.error.details);
    }
    throw new ApiClientError("INTERNAL_ERROR", "Something went wrong");
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiClientError("INTERNAL_ERROR", "Unexpected server response");
  }
  return parsed.data;
}

function jsonRequest(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export const api = {
  listGames(signal?: AbortSignal): Promise<GamesResponse> {
    return request("/api/games", signal === undefined ? {} : { signal }, gamesResponseSchema);
  },

  createRoom(input: CreateRoomRequest): Promise<CreateRoomResponse> {
    const parsed = createRoomRequestSchema.parse(input);
    return request("/api/rooms", jsonRequest(parsed), createRoomResponseSchema);
  },

  joinRoom(code: string, input: JoinRoomRequest): Promise<JoinRoomResponse> {
    const parsed = joinRoomRequestSchema.parse(input);
    return request(
      `/api/rooms/${encodeURIComponent(code)}/join`,
      jsonRequest(parsed),
      joinRoomResponseSchema,
    );
  },
};
