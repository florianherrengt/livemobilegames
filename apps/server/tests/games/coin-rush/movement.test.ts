import { describe, expect, it } from "vitest";

import { resolveMovement } from "../../../src/games/coin-rush/movement.js";
import { addPlayerAt, makeRuntime, player } from "./helpers.js";

function queue(
  runtime: ReturnType<typeof makeRuntime>,
  sessionId: string,
  direction: "up" | "down" | "left" | "right",
): void {
  runtime.pendingMoves.set(sessionId, { sequence: 1, direction });
}

describe("Coin Rush movement resolution", () => {
  it("moves one player into an empty cell", () => {
    const runtime = makeRuntime();
    addPlayerAt(runtime, "a", "A", 4, 4);
    queue(runtime, "a", "right");
    resolveMovement(runtime, 1_000);
    const a = player(runtime, "a");
    expect(a.moving).toBe(true);
    expect(a.toX).toBe(5);
    expect(a.toY).toBe(4);
    expect(a.push).toBe(false);
  });

  it("pushes one player and lets the initiator take the vacated cell", () => {
    const runtime = makeRuntime();
    addPlayerAt(runtime, "a", "A", 2, 2);
    addPlayerAt(runtime, "b", "B", 3, 2);
    queue(runtime, "a", "right");
    resolveMovement(runtime, 1_000);
    expect(player(runtime, "a").toX).toBe(3);
    expect(player(runtime, "b").toX).toBe(4);
    expect(player(runtime, "b").push).toBe(true);
  });

  it("propagates a three-player push chain", () => {
    const runtime = makeRuntime();
    addPlayerAt(runtime, "a", "A", 1, 3);
    addPlayerAt(runtime, "b", "B", 2, 3);
    addPlayerAt(runtime, "c", "C", 3, 3);
    queue(runtime, "a", "right");
    resolveMovement(runtime, 1_000);
    expect(player(runtime, "a").toX).toBe(2);
    expect(player(runtime, "b").toX).toBe(3);
    expect(player(runtime, "c").toX).toBe(4);
    expect(player(runtime, "c").push).toBe(true);
  });

  it("pushes the final player off the board edge and kills them", () => {
    const runtime = makeRuntime();
    addPlayerAt(runtime, "a", "A", 6, 2);
    addPlayerAt(runtime, "b", "B", 7, 2);
    addPlayerAt(runtime, "c", "C", 8, 2);
    queue(runtime, "a", "right");
    resolveMovement(runtime, 1_000);
    expect(player(runtime, "a").toX).toBe(7);
    expect(player(runtime, "b").toX).toBe(8);
    expect(player(runtime, "c").alive).toBe(false);
    expect(player(runtime, "c").deathType).toBe("fall");
    expect(player(runtime, "c").toX).toBe(9);
  });

  it("makes both players bounce when they target the same empty cell", () => {
    const runtime = makeRuntime();
    addPlayerAt(runtime, "a", "A", 2, 2);
    addPlayerAt(runtime, "b", "B", 4, 2);
    queue(runtime, "a", "right");
    queue(runtime, "b", "left");
    resolveMovement(runtime, 1_000);
    expect(player(runtime, "a").bouncing).toBe(true);
    expect(player(runtime, "b").bouncing).toBe(true);
    expect(player(runtime, "a").x).toBe(2);
    expect(player(runtime, "b").x).toBe(4);
  });

  it("makes both players bounce when they move into one another", () => {
    const runtime = makeRuntime();
    addPlayerAt(runtime, "a", "A", 2, 2);
    addPlayerAt(runtime, "b", "B", 3, 2);
    queue(runtime, "a", "right");
    queue(runtime, "b", "left");
    resolveMovement(runtime, 1_000);
    expect(player(runtime, "a").bouncing).toBe(true);
    expect(player(runtime, "b").bouncing).toBe(true);
    expect(player(runtime, "a").x).toBe(2);
    expect(player(runtime, "b").x).toBe(3);
  });

  it("lets an incoming player fill a cell whose occupant moves away", () => {
    const runtime = makeRuntime();
    addPlayerAt(runtime, "a", "A", 2, 2);
    addPlayerAt(runtime, "b", "B", 3, 2);
    queue(runtime, "b", "right");
    queue(runtime, "a", "right");
    resolveMovement(runtime, 1_000);
    expect(player(runtime, "a").toX).toBe(3);
    expect(player(runtime, "b").toX).toBe(4);
    expect(player(runtime, "b").push).toBe(false);
  });

  it("pushes an occupant whose own boundary move fails", () => {
    const runtime = makeRuntime();
    addPlayerAt(runtime, "a", "A", 7, 2);
    addPlayerAt(runtime, "b", "B", 8, 2);
    queue(runtime, "b", "right");
    queue(runtime, "a", "right");
    resolveMovement(runtime, 1_000);
    expect(player(runtime, "a").toX).toBe(8);
    expect(player(runtime, "b").alive).toBe(false);
    expect(player(runtime, "b").deathType).toBe("fall");
  });

  it("cancels opposing pushes into the same player", () => {
    const runtime = makeRuntime();
    addPlayerAt(runtime, "a", "A", 2, 2);
    addPlayerAt(runtime, "b", "B", 3, 2);
    addPlayerAt(runtime, "c", "C", 4, 2);
    queue(runtime, "a", "right");
    queue(runtime, "c", "left");
    resolveMovement(runtime, 1_000);
    expect(player(runtime, "a").bouncing).toBe(true);
    expect(player(runtime, "c").bouncing).toBe(true);
    expect(player(runtime, "b").x).toBe(3);
    expect(player(runtime, "b").moving).toBe(false);
  });

  it("cancels perpendicular pushes into the same player", () => {
    const runtime = makeRuntime();
    addPlayerAt(runtime, "a", "A", 2, 2);
    addPlayerAt(runtime, "b", "B", 3, 2);
    addPlayerAt(runtime, "c", "C", 3, 1);
    queue(runtime, "a", "right");
    queue(runtime, "c", "up");
    resolveMovement(runtime, 1_000);
    expect(player(runtime, "a").bouncing).toBe(true);
    expect(player(runtime, "c").bouncing).toBe(true);
    expect(player(runtime, "b").x).toBe(3);
    expect(player(runtime, "b").y).toBe(2);
  });

  it("lets independent movement elsewhere proceed during a conflict", () => {
    const runtime = makeRuntime();
    addPlayerAt(runtime, "a", "A", 2, 2);
    addPlayerAt(runtime, "b", "B", 4, 2);
    addPlayerAt(runtime, "d", "D", 6, 6);
    queue(runtime, "a", "right");
    queue(runtime, "b", "left");
    queue(runtime, "d", "up");
    resolveMovement(runtime, 1_000);
    expect(player(runtime, "a").bouncing).toBe(true);
    expect(player(runtime, "b").bouncing).toBe(true);
    expect(player(runtime, "d").toY).toBe(7);
    expect(player(runtime, "d").moving).toBe(true);
  });
});
