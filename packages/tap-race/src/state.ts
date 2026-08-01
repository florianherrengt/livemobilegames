import { MapSchema, type } from "@colyseus/schema";

import { PlatformPlayerState, PlatformState } from "@falling-platforms/platform-schema";

export type TapRacePhase = "lobby" | "countdown" | "playing" | "finished";

export class TapRacePlayerState extends PlatformPlayerState {
  @type("number") score = 0;
}

export class TapRaceState extends PlatformState {
  @type("string") phase: TapRacePhase = "lobby";
  /** Absolute epoch ms; 0 means not scheduled. */
  @type("number") startsAt = 0;
  /** Absolute epoch ms; 0 means not scheduled. */
  @type("number") endsAt = 0;
  @type({ map: TapRacePlayerState }) players = new MapSchema<TapRacePlayerState>();
}

export interface TapRaceClientPlayer {
  sessionId: string;
  name: string;
  score: number;
  isHost: boolean;
  isReady: boolean;
  connectionStatus: "connected" | "reconnecting" | "disconnected";
}

export interface TapRaceClientState {
  roomCode: string;
  gameId: string;
  status: "lobby" | "running" | "finished" | "closed";
  hostSessionId: string;
  phase: TapRacePhase;
  /** Absolute epoch ms; 0 means not scheduled. */
  startsAt: number;
  /** Absolute epoch ms; 0 means not scheduled. */
  endsAt: number;
  players: Map<string, TapRaceClientPlayer>;
  result: {
    winnerSessionIds: string[];
    leaderboard: Array<{
      sessionId: string;
      rank: number;
      primaryScore: number;
      label: string;
      secondaryLabel?: string | undefined;
    }>;
    finishedAt: number;
  } | null;
}
