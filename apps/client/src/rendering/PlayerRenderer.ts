import {
  type ClientPlayerState,
  clamp,
  easeInOut,
  HOP_DURATION_MS,
  hopEaseOut,
  JUMP_VISUAL_HEIGHT,
  lerp,
  parsePlatformId,
  platformCenterX,
  platformCenterY,
} from "@falling-platforms/shared";
import Phaser from "phaser";

import { COLORS, TEXT_STYLE } from "../game/config.js";

const BODY_SCALE = 0.25;
const RING_SCALE = 0.28;
const SHADOW_SCALE = 0.22;
const SNAP_BACK_MS = 140;

type PlayerDisplay = {
  sessionId: string;
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  ring: Phaser.GameObjects.Image;
  nameText: Phaser.GameObjects.Text;
  localHop: { from: string; to: string; startedAt: number } | null;
  snapBack: {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    startedAt: number;
  } | null;
  falling: boolean;
  hidden: boolean;
};

/** Renders players, hop interpolation, shadows, names and fall animations. */
export class PlayerRenderer {
  private scene: Phaser.Scene;
  private displays = new Map<string, PlayerDisplay>();
  private arenaSide = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  sync(
    players: ReadonlyMap<string, ClientPlayerState>,
    localSessionId: string,
    arenaSide: number,
    now: number,
  ): void {
    if (arenaSide !== this.arenaSide) {
      this.clearAll();
      this.arenaSide = arenaSide;
    }
    if (arenaSide <= 0) {
      return;
    }

    for (const [sessionId, player] of players) {
      if (!player.participating) {
        continue;
      }
      let display = this.displays.get(sessionId);
      if (!display) {
        display = this.createDisplay(sessionId, player.name);
        this.displays.set(sessionId, display);
      }
      this.updateDisplay(display, player, sessionId === localSessionId, arenaSide, now);
    }

    for (const [sessionId, display] of [...this.displays]) {
      const player = players.get(sessionId);
      if (!player?.participating) {
        display.container.destroy();
        this.displays.delete(sessionId);
      }
    }
  }

  /** Starts an optimistic local jump immediately on swipe. */
  startLocalHop(sessionId: string, from: string, to: string, startedAt: number): void {
    const display = this.displays.get(sessionId);
    if (display) {
      display.localHop = { from, to, startedAt };
      display.snapBack = null;
    }
  }

  /** Reconciles a rejected optimistic jump back to the authoritative platform. */
  cancelLocalHop(sessionId: string, currentPlatformId: string, arenaSide: number): void {
    const display = this.displays.get(sessionId);
    if (!display) {
      return;
    }
    display.localHop = null;
    const parts = parsePlatformId(currentPlatformId);
    if (!parts || arenaSide <= 0) {
      return;
    }
    display.snapBack = {
      fromX: display.container.x,
      fromY: display.container.y,
      toX: platformCenterX(parts.gridX, arenaSide),
      toY: platformCenterY(parts.gridY, arenaSide),
      startedAt: this.scene.time.now,
    };
  }

  getContainer(sessionId: string): Phaser.GameObjects.Container | null {
    return this.displays.get(sessionId)?.container ?? null;
  }

  getWorldPosition(sessionId: string): { x: number; y: number } | null {
    const container = this.displays.get(sessionId)?.container;
    if (!container) {
      return null;
    }
    return { x: container.x, y: container.y };
  }

  clearAll(): void {
    for (const display of this.displays.values()) {
      display.container.destroy();
    }
    this.displays.clear();
    this.arenaSide = 0;
  }

  private createDisplay(sessionId: string, name: string): PlayerDisplay {
    const container = this.scene.add.container(0, 0).setDepth(2);
    const color = playerColor(sessionId);

    const shadow = this.scene.add
      .image(0, 6, "shadow")
      .setTint(COLORS.shadow)
      .setAlpha(0.4)
      .setScale(SHADOW_SCALE);
    const body = this.scene.add.image(0, 0, "circle").setTint(color).setScale(BODY_SCALE);
    const ring = this.scene.add
      .image(0, 0, "circle-outline")
      .setTint(COLORS.localRing)
      .setScale(RING_SCALE)
      .setAlpha(0.9);
    const nameText = this.scene.add
      .text(0, 0, name, { ...TEXT_STYLE, fontSize: "13px" })
      .setOrigin(0.5, 0.5);

    container.add([shadow, body, ring, nameText]);
    return {
      sessionId,
      container,
      body,
      shadow,
      ring,
      nameText,
      localHop: null,
      snapBack: null,
      falling: false,
      hidden: false,
    };
  }

  private updateDisplay(
    display: PlayerDisplay,
    player: ClientPlayerState,
    isLocal: boolean,
    arenaSide: number,
    now: number,
  ): void {
    if (!player.alive) {
      if (!display.falling) {
        this.startFall(display);
      }
      return;
    }
    if (display.falling) {
      display.falling = false;
      display.hidden = false;
      display.container.setVisible(true);
      display.body.setAlpha(1);
      display.body.setScale(BODY_SCALE);
      display.shadow.setAlpha(0.4);
      display.shadow.setScale(SHADOW_SCALE);
      display.ring.setAlpha(0.9);
      display.nameText.setAlpha(1);
    }

    let baseX: number;
    let baseY: number;
    let height = 0;
    let heightNorm = 0;

    if (player.jumping && player.fromPlatformId && player.targetPlatformId) {
      // For the local player, keep using the optimistic timeline (started at
      // the swipe) when the server accepted the same jump, so the accepted
      // patch does not restart the animation mid-flight.
      const localHop = display.localHop;
      const useLocalTimeline =
        isLocal &&
        localHop !== null &&
        localHop.from === player.fromPlatformId &&
        localHop.to === player.targetPlatformId;
      const duration = useLocalTimeline
        ? HOP_DURATION_MS
        : Math.max(1, player.jumpEndsAt - player.jumpStartedAt);
      const startedAt = useLocalTimeline ? localHop.startedAt : player.jumpStartedAt;
      const progress = clamp((now - startedAt) / duration, 0, 1);
      const eased = hopEaseOut(progress);
      const from = parsePlatformId(player.fromPlatformId);
      const to = parsePlatformId(player.targetPlatformId);
      if (from && to) {
        baseX = lerp(
          platformCenterX(from.gridX, arenaSide),
          platformCenterX(to.gridX, arenaSide),
          eased,
        );
        baseY = lerp(
          platformCenterY(from.gridY, arenaSide),
          platformCenterY(to.gridY, arenaSide),
          eased,
        );
      } else {
        const parts = parsePlatformId(player.currentPlatformId);
        baseX = parts ? platformCenterX(parts.gridX, arenaSide) : display.container.x;
        baseY = parts ? platformCenterY(parts.gridY, arenaSide) : display.container.y;
      }
      height = Math.sin(Math.PI * progress) * JUMP_VISUAL_HEIGHT;
      heightNorm = height / JUMP_VISUAL_HEIGHT;
    } else if (isLocal && display.localHop) {
      const progress = clamp((now - display.localHop.startedAt) / HOP_DURATION_MS, 0, 1);
      const eased = hopEaseOut(progress);
      const from = parsePlatformId(display.localHop.from);
      const to = parsePlatformId(display.localHop.to);
      if (from && to) {
        baseX = lerp(
          platformCenterX(from.gridX, arenaSide),
          platformCenterX(to.gridX, arenaSide),
          eased,
        );
        baseY = lerp(
          platformCenterY(from.gridY, arenaSide),
          platformCenterY(to.gridY, arenaSide),
          eased,
        );
      } else {
        const parts = parsePlatformId(player.currentPlatformId);
        baseX = parts ? platformCenterX(parts.gridX, arenaSide) : display.container.x;
        baseY = parts ? platformCenterY(parts.gridY, arenaSide) : display.container.y;
      }
      height = Math.sin(Math.PI * progress) * JUMP_VISUAL_HEIGHT;
      heightNorm = height / JUMP_VISUAL_HEIGHT;
    } else if (display.snapBack) {
      const snap = display.snapBack;
      const t = clamp((now - snap.startedAt) / SNAP_BACK_MS, 0, 1);
      const eased = easeInOut(t);
      baseX = lerp(snap.fromX, snap.toX, eased);
      baseY = lerp(snap.fromY, snap.toY, eased);
      if (t >= 1) {
        display.snapBack = null;
      }
    } else {
      const parts = parsePlatformId(player.currentPlatformId);
      baseX = parts ? platformCenterX(parts.gridX, arenaSide) : display.container.x;
      baseY = parts ? platformCenterY(parts.gridY, arenaSide) : display.container.y;
    }

    display.container.setPosition(baseX, baseY);
    display.body.setY(-height);
    display.ring.setY(-height);
    display.nameText.setY(-height - 30);
    display.ring.setVisible(isLocal);
    display.shadow.setAlpha(0.4 * (1 - 0.55 * heightNorm));
    display.shadow.setScale(SHADOW_SCALE * (1 - 0.28 * heightNorm));
  }

  private startFall(display: PlayerDisplay): void {
    display.falling = true;
    display.hidden = false;
    display.localHop = null;
    display.snapBack = null;
    this.scene.tweens.add({
      targets: display.body,
      y: 110,
      alpha: 0,
      scale: 0.42,
      duration: 700,
      ease: "Sine.easeIn",
    });
    this.scene.tweens.add({
      targets: display.shadow,
      alpha: 0,
      scale: 0.1,
      duration: 700,
      ease: "Sine.easeIn",
    });
    this.scene.tweens.add({ targets: display.ring, alpha: 0, duration: 300 });
    this.scene.tweens.add({
      targets: display.nameText,
      alpha: 0,
      duration: 300,
      onComplete: () => {
        display.container.setVisible(false);
        display.hidden = true;
      },
    });
  }
}

/** Deterministic bright colour derived from the session id. */
export function playerColor(sessionId: string): number {
  let hash = 0;
  for (let i = 0; i < sessionId.length; i++) {
    hash = (hash * 31 + sessionId.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return Phaser.Display.Color.HSLToColor(hue / 360, 0.72, 0.6).color;
}
