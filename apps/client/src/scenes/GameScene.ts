import {
  arenaOriginX,
  arenaOriginY,
  type ClientGameState,
  type ClientPlayerState,
  type HopRejection,
  type MatchPhase,
  parsePlatformId,
  platformId,
  TILE_PITCH,
} from "@falling-platforms/shared";
import Phaser from "phaser";

import { initialiseAudio, playHopSound } from "../audio/audio.js";
import { CAMERA_ZOOM } from "../game/config.js";
import { SWIPE_DELTAS, SwipeController, type SwipeDirection } from "../input/SwipeController.js";
import type { GameClient } from "../networking/GameClient.js";
import { ArenaRenderer } from "../rendering/ArenaRenderer.js";
import { PlayerRenderer } from "../rendering/PlayerRenderer.js";
import type { ScreensApi } from "../ui/screens.js";

type SceneData = {
  client: GameClient;
  screens: ScreensApi;
};

const COUNTDOWN_LABELS = ["3", "2", "1", "GO"];
const COUNTDOWN_STEP_MS = 1_000;

/**
 * Renders the authoritative arena and players, owns local input state
 * (optimistic hops, buffered swipes, spectator follow) and reconciles against
 * server patches. Nothing here invents movement the server did not authorise.
 */
export class GameScene extends Phaser.Scene {
  private client!: GameClient;
  private screens!: ScreensApi;
  private arenaRenderer!: ArenaRenderer;
  private playerRenderer!: PlayerRenderer;
  private swipeController!: SwipeController;
  private latestState: ClientGameState | null = null;
  private latestPhase: MatchPhase | null = null;
  private prevLocal: {
    alive: boolean;
    jumping: boolean;
    currentPlatformId: string;
  } | null = null;
  private bufferedDirection: SwipeDirection | null = null;
  private pendingHop: { sequence: number; target: string } | null = null;
  private sequence = 0;
  private followSessionId: string | null = null;
  private cameraTarget: Phaser.GameObjects.Container | null = null;
  private countdownEvent: Phaser.Time.TimerEvent | null = null;

  constructor() {
    super("Game");
  }

  init(data: SceneData): void {
    this.client = data.client;
    this.screens = data.screens;
  }

  create(): void {
    this.arenaRenderer = new ArenaRenderer(this);
    this.playerRenderer = new PlayerRenderer(this);
    this.swipeController = new SwipeController(this);
    this.swipeController.attach();
    this.client.onStateChange((state) => this.handleStateChange(state));
    this.client.onHopRejected((rejection) => this.handleHopRejected(rejection));
    this.client.onLeave(() => this.clearRoundState());
    this.cameras.main.setBackgroundColor("#0b0e14");
    this.cameras.main.setZoom(CAMERA_ZOOM);
    const initial = this.client.getState();
    if (initial) {
      this.handleStateChange(initial);
    }
  }

  getLatestState(): ClientGameState | null {
    return this.latestState;
  }

  getSessionId(): string {
    return this.client.sessionId;
  }

  update(time: number): void {
    const state = this.latestState;
    if (!state || state.phase === "lobby") {
      return;
    }

    this.arenaRenderer.sync(state.platforms, state.arenaSide);
    const local = state.players.get(this.client.sessionId);
    const bufferedTarget = this.bufferedTargetId(local);
    const occupiedPlatformIds = new Set<string>();
    for (const [sessionId, player] of state.players) {
      if (sessionId === this.client.sessionId || !player.participating || !player.alive) {
        continue;
      }
      occupiedPlatformIds.add(player.jumping ? player.targetPlatformId : player.currentPlatformId);
    }
    this.arenaRenderer.updateOutlines({
      phase: state.phase,
      localAlive: local?.alive ?? false,
      localGrounded: local ? !local.jumping : false,
      localPlatformId: local?.currentPlatformId ?? "",
      bufferedTarget,
      occupiedPlatformIds,
      platforms: state.platforms,
      arenaSide: state.arenaSide,
    });
    this.playerRenderer.sync(state.players, this.client.sessionId, state.arenaSide, time);
    this.updateCamera(state);
  }

  handleStateChange(state: ClientGameState): void {
    const previousPhase = this.latestPhase;
    this.latestPhase = state.phase;
    this.latestState = state;

    if (state.phase !== previousPhase) {
      if (state.phase === "countdown") {
        this.startCountdown();
        this.setupCamera(state);
      } else if (state.phase === "playing") {
        this.screens.hideCountdown();
        this.setupCamera(state);
      } else if (state.phase === "results") {
        this.screens.hideCountdown();
        this.screens.showResults(state);
        this.clearMovementState();
      } else if (state.phase === "lobby") {
        this.screens.hideCountdown();
        this.screens.hideResults();
        this.clearRoundState();
      }
    }

    if (
      (previousPhase === "lobby" || previousPhase === "countdown") &&
      state.phase === "playing" &&
      state.arenaSide > 0
    ) {
      this.setupCamera(state);
    }

    const local = state.players.get(this.client.sessionId);
    if (local) {
      const prev = this.prevLocal;
      if (prev) {
        if (prev.alive && !local.alive) {
          this.onLocalEliminated();
        } else if (
          (prev.jumping && !local.jumping) ||
          (!prev.jumping && !local.jumping && prev.currentPlatformId !== local.currentPlatformId)
        ) {
          this.onLocalLanded(local);
        }
      }
      this.prevLocal = {
        alive: local.alive,
        jumping: local.jumping,
        currentPlatformId: local.currentPlatformId,
      };
    } else {
      this.prevLocal = null;
    }

    this.updateSpectatorFollow(state);
  }

  handleHopRejected(rejection: HopRejection): void {
    if (!this.pendingHop || rejection.sequence !== this.pendingHop.sequence) {
      return;
    }
    const rejectedTarget = this.pendingHop.target;
    this.pendingHop = null;
    this.bufferedDirection = null;
    const state = this.latestState;
    const local = state?.players.get(this.client.sessionId);
    this.playerRenderer.cancelLocalHop(
      this.client.sessionId,
      local?.currentPlatformId ?? "",
      state?.arenaSide ?? 0,
    );
    if (rejection.reason !== "rate-limited") {
      this.arenaRenderer.invalidPulse(rejectedTarget, state?.arenaSide ?? 0);
    }
  }

  /** Swipe onto a valid adjacent platform: immediate animation + server request. */
  requestHop(targetId: string): void {
    const state = this.latestState;
    const local = state?.players.get(this.client.sessionId);
    if (state?.phase !== "playing" || !local || !local.alive || local.jumping) {
      return;
    }
    initialiseAudio();
    playHopSound();
    this.bufferedDirection = null;
    const sequence = ++this.sequence;
    this.pendingHop = { sequence, target: targetId };
    this.playerRenderer.startLocalHop(
      this.client.sessionId,
      local.currentPlatformId,
      targetId,
      this.time.now,
    );
    this.client.sendHop({ sequence, targetPlatformId: targetId });
  }

  /** Airborne swipes only buffer the most recent direction. */
  bufferDirection(direction: SwipeDirection): void {
    this.bufferedDirection = direction;
  }

  /** Muted pulse for an invalid swipe (gone or unreachable platform). */
  invalidPulse(targetId: string): void {
    this.arenaRenderer.invalidPulse(targetId, this.latestState?.arenaSide ?? 0);
  }

  /** True when another participant is on the tile or committed to landing there. */
  isTargetOccupied(targetId: string): boolean {
    const state = this.latestState;
    if (!state) {
      return false;
    }
    for (const [sessionId, player] of state.players) {
      if (sessionId === this.client.sessionId || !player.participating || !player.alive) {
        continue;
      }
      if ((player.jumping ? player.targetPlatformId : player.currentPlatformId) === targetId) {
        return true;
      }
    }
    return false;
  }

  /** Spectator: tap a visible living player to follow them. */
  tryFollowAt(worldX: number, worldY: number): void {
    const state = this.latestState;
    if (!state) {
      return;
    }
    for (const [sessionId, player] of state.players) {
      if (!player.participating || !player.alive) {
        continue;
      }
      const position = this.playerRenderer.getWorldPosition(sessionId);
      if (position && Math.hypot(worldX - position.x, worldY - position.y) <= 46) {
        this.followSessionId = sessionId;
        return;
      }
    }
  }

  setSpectatorFollow(sessionId: string): void {
    this.followSessionId = sessionId;
  }

  private onLocalLanded(local: ClientPlayerState): void {
    const state = this.latestState;
    if (!state || !this.bufferedDirection) {
      return;
    }
    const current = parsePlatformId(local.currentPlatformId);
    const direction = this.bufferedDirection;
    this.bufferedDirection = null;
    if (!current) {
      return;
    }
    const delta = SWIPE_DELTAS[direction];
    const gridX = current.gridX + delta.dx;
    const gridY = current.gridY + delta.dy;
    if (gridX < 0 || gridY < 0 || gridX >= state.arenaSide || gridY >= state.arenaSide) {
      return;
    }
    const targetId = platformId(gridX, gridY);
    const target = state.platforms.get(targetId);
    if (target && target.state !== "gone" && !this.isTargetOccupied(targetId)) {
      this.requestHop(targetId);
    } else if (target) {
      this.arenaRenderer.invalidPulse(targetId, state.arenaSide);
    }
  }

  private onLocalEliminated(): void {
    this.clearMovementState();
    this.followSessionId = null;
  }

  private clearMovementState(): void {
    this.bufferedDirection = null;
    this.pendingHop = null;
  }

  /** The tile a buffered swipe would land on from the current position. */
  private bufferedTargetId(local: ClientPlayerState | undefined): string | null {
    if (!local || !this.bufferedDirection) {
      return null;
    }
    const current = parsePlatformId(local.currentPlatformId);
    if (!current) {
      return null;
    }
    const delta = SWIPE_DELTAS[this.bufferedDirection];
    const gridX = current.gridX + delta.dx;
    const gridY = current.gridY + delta.dy;
    const arenaSide = this.latestState?.arenaSide ?? 0;
    if (gridX < 0 || gridY < 0 || gridX >= arenaSide || gridY >= arenaSide) {
      return null;
    }
    return platformId(gridX, gridY);
  }

  private clearRoundState(): void {
    this.clearMovementState();
    this.prevLocal = null;
    this.latestPhase = null;
    this.followSessionId = null;
    this.sequence = 0;
    this.stopCountdown();
    this.playerRenderer.clearAll();
    this.arenaRenderer.clearAll();
  }

  private startCountdown(): void {
    const first = COUNTDOWN_LABELS[0];
    if (first) {
      this.screens.showCountdown(first);
    }
    this.stopCountdown();
    let step = 0;
    this.countdownEvent = this.time.addEvent({
      delay: COUNTDOWN_STEP_MS,
      repeat: COUNTDOWN_LABELS.length - 1,
      callback: () => {
        step += 1;
        const label = COUNTDOWN_LABELS[step];
        if (label) {
          this.screens.showCountdown(label);
        }
      },
    });
  }

  private stopCountdown(): void {
    if (this.countdownEvent) {
      this.countdownEvent.remove();
      this.countdownEvent = null;
    }
  }

  private setupCamera(state: ClientGameState): void {
    const side = state.arenaSide;
    if (side <= 0) {
      return;
    }
    const size = side * TILE_PITCH;
    this.cameras.main.setBounds(arenaOriginX(side), arenaOriginY(side), size, size);
    this.cameras.main.setZoom(CAMERA_ZOOM);
    this.cameras.main.centerOn(0, 0);
  }

  private updateSpectatorFollow(state: ClientGameState): void {
    if (this.followSessionId) {
      const followed = state.players.get(this.followSessionId);
      if (followed?.participating && followed.alive) {
        return;
      }
      this.followSessionId = null;
    }
    const survivors = [...state.players.entries()]
      .filter(([, player]) => player.participating && player.alive)
      .sort((a, b) => a[1].joinedOrder - b[1].joinedOrder);
    this.followSessionId = survivors[0]?.[0] ?? null;
  }

  private updateCamera(state: ClientGameState): void {
    const local = state.players.get(this.client.sessionId);
    let targetId: string | null = null;
    if (local?.participating && local.alive) {
      targetId = this.client.sessionId;
    } else if (this.followSessionId && state.players.get(this.followSessionId)?.alive) {
      targetId = this.followSessionId;
    }
    const target = targetId !== null ? this.playerRenderer.getContainer(targetId) : null;
    document
      .getElementById("app")
      ?.setAttribute(
        "data-camera-scroll",
        `${this.cameras.main.scrollX},${this.cameras.main.scrollY}`,
      );
    if (target && this.cameraTarget !== target) {
      this.cameras.main.startFollow(target, false, 0.12, 0.12);
      this.cameraTarget = target;
    } else if (!target && this.cameraTarget) {
      this.cameras.main.stopFollow();
      this.cameraTarget = null;
    }
  }
}
