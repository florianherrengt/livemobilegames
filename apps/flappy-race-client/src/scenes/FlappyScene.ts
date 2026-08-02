import {
  FLAPPY_RACE_CONFIG,
  type FlappyRaceClientState,
  extrapolateBirdY,
  obstacleLeftX,
} from "@falling-platforms/flappy-race";
import Phaser from "phaser";

import { COLORS } from "../game/config.js";
import type { GameClient } from "../networking/GameClient.js";
import type { ScreensApi } from "../ui/screens.js";

type SceneData = {
  client: GameClient;
  screens: ScreensApi;
};

interface BirdSample {
  y: number;
  vy: number;
  at: number;
}

const OBSTACLE_POOL_SIZE = 12;
const MAX_EXTRAPOLATION_MS = 80;

/**
 * Renders the authoritative Flappy Race course: shared obstacles, every
 * player's bird, and a squash cue on flap. Birds and obstacles are extrapolated
 * from the latest authoritative snapshot by the same short interval so the
 * rendered geometry stays aligned with the server's collision checks. Nothing
 * here invents course geometry the server did not authorise.
 */
export class FlappyScene extends Phaser.Scene {
  private client!: GameClient;
  private latestState: FlappyRaceClientState | null = null;
  private lastStateAt = 0;
  private birdContainers = new Map<string, Phaser.GameObjects.Container>();
  private birdBodies = new Map<string, Phaser.GameObjects.Image>();
  private birdWings = new Map<string, Phaser.GameObjects.Image>();
  private samples = new Map<string, BirdSample>();
  private topPillars: Phaser.GameObjects.Image[] = [];
  private bottomPillars: Phaser.GameObjects.Image[] = [];
  private background!: Phaser.GameObjects.Graphics;
  private flapSquash = 0;
  private sequence = 0;

  constructor() {
    super("Flappy");
  }

  init(data: SceneData): void {
    this.client = data.client;
  }

  create(): void {
    this.drawBackground();
    this.createObstaclePool();
    this.input.on("pointerdown", () => this.handleTap());
    this.client.onStateChange((state) => this.handleStateChange(state));
    this.client.onLeave(() => this.clearRoundState());

    const initial = this.client.getState();
    if (initial) {
      this.handleStateChange(initial);
    }
  }

  private handleStateChange(state: FlappyRaceClientState): void {
    this.latestState = state;
    this.lastStateAt = this.time.now;

    for (const [sessionId, player] of state.players) {
      if (player.roundActive) {
        this.pushSample(sessionId, player.birdY, player.birdVy);
      } else {
        this.samples.delete(sessionId);
      }
    }
    for (const sessionId of [...this.samples.keys()]) {
      if (!state.players.has(sessionId)) {
        this.samples.delete(sessionId);
      }
    }

    if (state.phase === "lobby") {
      this.clearRoundState();
    }
  }

  override update(_time: number, delta: number): void {
    const state = this.latestState;
    if (!state || state.phase === "lobby" || state.phase === "finished") {
      return;
    }
    const extrapolation = this.extrapolationDelta();
    const displayElapsed = this.displayElapsedMs(state, extrapolation);
    this.renderObstacles(state, displayElapsed);
    this.renderBirds(state, delta, extrapolation);
  }

  private extrapolationDelta(): number {
    return Math.min(MAX_EXTRAPOLATION_MS, Math.max(0, this.time.now - this.lastStateAt));
  }

  private displayElapsedMs(state: FlappyRaceClientState, extrapolation: number): number {
    if (state.phase === "countdown") {
      return 0;
    }
    if (state.phase === "running") {
      return state.courseElapsedMs + extrapolation;
    }
    return state.courseElapsedMs;
  }

  private renderObstacles(state: FlappyRaceClientState, elapsedMs: number): void {
    const config = FLAPPY_RACE_CONFIG;
    const speed = state.courseSpeed || config.courseSpeed;
    const traveled = (speed * elapsedMs) / 1000;
    const firstIndex = Math.max(
      0,
      Math.floor(
        (traveled - config.worldWidth - config.safeStartDistance) / config.obstacleSpacing,
      ) - 1,
    );

    let used = 0;
    for (let offset = 0; offset < OBSTACLE_POOL_SIZE; offset++) {
      const index = firstIndex + offset;
      const gapTop = state.obstacleOpenings[index];
      const top = this.topPillars[offset];
      const bottom = this.bottomPillars[offset];
      if (gapTop === undefined || !top || !bottom) {
        break;
      }
      const leftX = obstacleLeftX(config, index, speed, elapsedMs);
      if (leftX > config.worldWidth + config.obstacleWidth + 40) {
        break;
      }
      used = offset + 1;
      top.setVisible(true);
      bottom.setVisible(true);
      const gapBottom = gapTop + config.gapSize;
      // Images use their centre as the origin, so the pillar spans exactly
      // 0..gapTop (top) and gapBottom..worldHeight (bottom), matching the
      // authoritative collision geometry.
      top.setPosition(leftX + config.obstacleWidth / 2, gapTop / 2);
      top.setDisplaySize(config.obstacleWidth, gapTop);
      bottom.setPosition(
        leftX + config.obstacleWidth / 2,
        gapBottom + (config.worldHeight - gapBottom) / 2,
      );
      bottom.setDisplaySize(config.obstacleWidth, config.worldHeight - gapBottom);
    }
    for (let index = used; index < OBSTACLE_POOL_SIZE; index++) {
      this.topPillars[index]?.setVisible(false);
      this.bottomPillars[index]?.setVisible(false);
    }
  }

  private renderBirds(
    state: FlappyRaceClientState,
    delta: number,
    extrapolation: number,
  ): void {
    const localSessionId = this.client.sessionId;
    this.flapSquash = Math.max(0, this.flapSquash - delta / 120);
    for (const [sessionId, player] of state.players) {
      if (!player.roundActive || (state.phase !== "countdown" && state.phase !== "running")) {
        this.hideBird(sessionId);
        continue;
      }
      const y = this.extrapolatedY(sessionId, player.birdY, extrapolation);
      this.showBird(sessionId, player.color, y);
      if (sessionId === localSessionId) {
        const container = this.birdContainers.get(sessionId);
        const squash = this.flapSquash;
        if (container) {
          container.setScale(1 - 0.12 * squash, 1 + 0.16 * squash);
        }
      }
    }
    for (const sessionId of [...this.birdContainers.keys()]) {
      if (!state.players.has(sessionId)) {
        this.destroyBird(sessionId);
      }
    }
  }

  private extrapolatedY(
    sessionId: string,
    currentY: number,
    extrapolation: number,
  ): number {
    const samples = this.samples.get(sessionId);
    if (!samples) {
      return currentY;
    }
    const deltaMs = Math.min(MAX_EXTRAPOLATION_MS, Math.max(0, extrapolation));
    return extrapolateBirdY(samples.y, samples.vy, deltaMs, FLAPPY_RACE_CONFIG);
  }

  private pushSample(sessionId: string, y: number, vy: number): void {
    this.samples.set(sessionId, { y, vy, at: this.time.now });
  }

  private showBird(sessionId: string, color: string, y: number): void {
    let container = this.birdContainers.get(sessionId);
    if (!container) {
      container = this.createBird(sessionId, color);
      this.birdContainers.set(sessionId, container);
    }
    container.setVisible(true);
    container.setPosition(
      FLAPPY_RACE_CONFIG.birdX + FLAPPY_RACE_CONFIG.birdWidth / 2,
      y + FLAPPY_RACE_CONFIG.birdHeight / 2,
    );
  }

  private hideBird(sessionId: string): void {
    const container = this.birdContainers.get(sessionId);
    if (container) {
      container.setVisible(false);
    }
  }

  private createBird(sessionId: string, color: string): Phaser.GameObjects.Container {
    const body = this.add
      .image(0, 0, "bird-body")
      .setDisplaySize(27, 27)
      .setTint(Phaser.Display.Color.HexStringToColor(color).color);
    const wing = this.add.image(1, 6, "bird-wing").setDisplaySize(21, 11).setTint(0x1f2c38);
    const beak = this.add.image(13, 1, "bird-beak").setDisplaySize(11, 11).setTint(COLORS.beak);
    const eye = this.add.image(4, -5, "bird-eye").setDisplaySize(8, 8);
    const pupil = this.add.image(5, -5, "bird-pupil").setDisplaySize(4, 4);
    const container = this.add.container(0, 0, [body, wing, beak, eye, pupil]);
    this.birdBodies.set(sessionId, body);
    this.birdWings.set(sessionId, wing);
    return container;
  }

  private destroyBird(sessionId: string): void {
    const container = this.birdContainers.get(sessionId);
    if (container) {
      container.destroy();
    }
    this.birdContainers.delete(sessionId);
    this.birdBodies.delete(sessionId);
    this.birdWings.delete(sessionId);
  }

  private handleTap(): void {
    const state = this.latestState;
    if (!state || (state.phase !== "countdown" && state.phase !== "running")) {
      return;
    }
    const local = state.players.get(this.client.sessionId);
    if (!local?.roundActive) {
      return;
    }
    // Immediate visual response: a short squash cue. The position itself stays
    // on the authoritative snapshot so collisions never look unfair.
    this.flapSquash = 1;
    this.sequence += 1;
    this.client.sendFlap(this.sequence, state.roundNumber);
  }

  private drawBackground(): void {
    this.background = this.add.graphics();
    const steps = 12;
    const stepHeight = FLAPPY_RACE_CONFIG.worldHeight / steps;
    const top = Phaser.Display.Color.ValueToColor(COLORS.backgroundTop);
    const bottom = Phaser.Display.Color.ValueToColor(COLORS.backgroundBottom);
    for (let index = 0; index < steps; index++) {
      const t = (index + 0.5) / steps;
      const color = Phaser.Display.Color.Interpolate.ColorWithColor(top, bottom, 1, t);
      this.background.fillStyle(Phaser.Display.Color.GetColor(color.r, color.g, color.b), 1);
      this.background.fillRect(
        0,
        index * stepHeight,
        FLAPPY_RACE_CONFIG.worldWidth,
        stepHeight + 1,
      );
    }
    this.background.fillStyle(COLORS.ground, 1);
    this.background.fillRect(
      0,
      FLAPPY_RACE_CONFIG.worldHeight - 6,
      FLAPPY_RACE_CONFIG.worldWidth,
      6,
    );
    this.background.setDepth(-10);
  }

  private createObstaclePool(): void {
    for (let index = 0; index < OBSTACLE_POOL_SIZE; index++) {
      const top = this.add
        .image(0, 0, "pixel")
        .setOrigin(0.5, 0.5)
        .setTint(COLORS.obstacle)
        .setVisible(false);
      const bottom = this.add
        .image(0, 0, "pixel")
        .setOrigin(0.5, 0.5)
        .setTint(COLORS.obstacle)
        .setVisible(false);
      this.topPillars.push(top);
      this.bottomPillars.push(bottom);
    }
  }

  private clearRoundState(): void {
    this.samples.clear();
    this.flapSquash = 0;
    for (const container of this.birdContainers.values()) {
      container.destroy();
    }
    this.birdContainers.clear();
    this.birdBodies.clear();
    this.birdWings.clear();
    this.sequence = 0;
  }
}
