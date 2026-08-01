import type { MapSchema } from "@colyseus/schema";
import type { PlatformPlayerState, PlatformState } from "@falling-platforms/platform-schema";

import type { CommandResult, GameConfig, ProtocolError } from "@falling-platforms/platform-shared";
import { gameConfigSchema, protocolError } from "@falling-platforms/platform-shared";
import type { ZodType } from "zod";

import type { GameContext } from "./game-context.js";

export interface GameDefinition<
  TState extends PlatformState & { players: MapSchema<TPlayerState> },
  TPlayerState extends PlatformPlayerState,
  TCommand = unknown,
> {
  readonly id: string;
  readonly config: GameConfig;
  readonly commandSchema: ZodType<TCommand>;

  createState(context: GameContext): TState;
  createPlayerState(context: GameContext, sessionId: string): TPlayerState;

  onJoin?(context: GameContext, state: TState, sessionId: string): void;
  onDrop?(context: GameContext, state: TState, sessionId: string): void;
  onReconnect?(context: GameContext, state: TState, sessionId: string): void;
  onRemoved?(context: GameContext, state: TState, sessionId: string): void;
  onStart?(context: GameContext, state: TState): void;

  onCommand(
    context: GameContext,
    state: TState,
    sessionId: string,
    command: TCommand,
  ): CommandResult | undefined;

  onTick?(context: GameContext, state: TState, now: number): void;
  onReset?(context: GameContext, state: TState): void;
  onDispose?(context: GameContext, state: TState): void;
}

export function assertValidGameDefinition<
  TState extends PlatformState & { players: MapSchema<TPlayerState> },
  TPlayerState extends PlatformPlayerState,
  TCommand,
>(game: GameDefinition<TState, TPlayerState, TCommand>): ProtocolError | null {
  if (!game.id.trim()) {
    return protocolError("INVALID_REQUEST", "Game id must not be empty");
  }
  const config = gameConfigSchema.safeParse(game.config);
  if (!config.success) {
    return protocolError("INVALID_REQUEST", "Invalid game configuration", {
      issues: config.error.issues,
    });
  }
  return null;
}
