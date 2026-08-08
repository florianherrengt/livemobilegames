import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ArenaView } from "../games/golf-race/arena-view.js";
import {
  makeGolfRaceResult,
  makeGolfRaceState,
  makeRoomConnection,
} from "../games/golf-race/fixtures.js";
import { GolfRaceGameView } from "../games/golf-race/game-view.js";

const feedback = vi.hoisted(() => ({
  gameFeedback: vi.fn(),
  hapticFeedback: vi.fn(),
  primeGameFeedback: vi.fn(),
}));

vi.mock("../feedback.js", () => feedback);

function createMockContext(): CanvasRenderingContext2D {
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    lineCap: "butt",
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    setLineDash: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

class MockResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

describe("GolfRaceGameView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(createMockContext());
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows the waiting lobby before a match", () => {
    const state = makeGolfRaceState("lobby");
    const { connection } = makeRoomConnection(state);
    render(<GolfRaceGameView connection={connection} state={state} selfSessionId="host-session" />);
    expect(screen.getByText("Players (2)")).toBeInTheDocument();
    expect(
      screen.getByText("Waiting for everyone to join, then the first round starts automatically."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Play again" })).not.toBeInTheDocument();
  });

  it("shows the how-to during countdown and hides it once play begins", () => {
    const state = makeGolfRaceState("countdown");
    const { connection } = makeRoomConnection(state);
    const { rerender } = render(
      <GolfRaceGameView connection={connection} state={state} selfSessionId="host-session" />,
    );
    expect(screen.getByText("How to play Golf Race")).toBeInTheDocument();
    rerender(
      <GolfRaceGameView
        connection={connection}
        state={makeGolfRaceState("aiming")}
        selfSessionId="host-session"
      />,
    );
    expect(screen.queryByText("How to play Golf Race")).not.toBeInTheDocument();
  });

  it("sends a shot intent from a drag and release", () => {
    const state = makeGolfRaceState("aiming");
    const { connection, sent } = makeRoomConnection(state);
    const { container } = render(
      <ArenaView connection={connection} state={state} selfSessionId="host-session" />,
    );
    const arena = container.querySelector("[data-testid='golf-race-arena']");
    if (!arena) {
      throw new Error("arena missing");
    }
    fireEvent.pointerDown(arena, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(arena, { pointerId: 1, clientX: 100, clientY: 180 });
    fireEvent.pointerUp(arena, { pointerId: 1, clientX: 100, clientY: 180 });
    expect(feedback.gameFeedback).toHaveBeenCalledWith("move");
    expect(sent).toContainEqual({
      type: "game:shot",
      payload: { type: "shot", sequence: 1, roundNumber: 1, aimX: 0, aimY: 80 },
    });
  });

  it("sends a shot intent from keyboard aim and release", () => {
    const state = makeGolfRaceState("aiming");
    const { connection, sent } = makeRoomConnection(state);
    const { container } = render(
      <ArenaView connection={connection} state={state} selfSessionId="host-session" />,
    );
    const arena = container.querySelector("[data-testid='golf-race-arena']");
    if (!arena) {
      throw new Error("arena missing");
    }
    fireEvent.keyDown(arena, { key: "ArrowDown" });
    fireEvent.keyDown(arena, { key: " " });
    expect(sent).toContainEqual({
      type: "game:shot",
      payload: { type: "shot", sequence: 1, roundNumber: 1, aimX: 0, aimY: 114 },
    });
  });

  it("disables input while spectating", () => {
    const state = makeGolfRaceState("aiming", { currentTurnSessionId: "bob-session" });
    const { connection, sent } = makeRoomConnection(state);
    const { container } = render(
      <ArenaView connection={connection} state={state} selfSessionId="host-session" />,
    );
    const arena = container.querySelector("[data-testid='golf-race-arena']");
    if (!arena) {
      throw new Error("arena missing");
    }
    fireEvent.pointerDown(arena, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(arena, { pointerId: 1, clientX: 100, clientY: 180 });
    expect(sent).toHaveLength(0);
    expect(arena).toHaveAttribute("data-spectating", "true");
    expect(screen.getByText("Spectating")).toBeInTheDocument();
  });

  it("cancels an unfinished drag when the turn ends", () => {
    const state = makeGolfRaceState("aiming");
    const { connection, sent } = makeRoomConnection(state);
    const { container, rerender } = render(
      <ArenaView connection={connection} state={state} selfSessionId="host-session" />,
    );
    const arena = container.querySelector("[data-testid='golf-race-arena']");
    if (!arena) {
      throw new Error("arena missing");
    }
    fireEvent.pointerDown(arena, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(arena, { pointerId: 1, clientX: 100, clientY: 180 });

    const simulating = makeGolfRaceState("simulating");
    rerender(<ArenaView connection={connection} state={simulating} selfSessionId="host-session" />);
    fireEvent.pointerUp(arena, { pointerId: 1, clientX: 100, clientY: 180 });
    expect(sent).toHaveLength(0);
  });

  it("shows the finished leaderboard and lets the host play again", () => {
    const state = makeGolfRaceState("finished", {
      result: makeGolfRaceResult(),
      aliceFinished: true,
      bobFinished: true,
    });
    const { connection, sent } = makeRoomConnection(state);
    render(<GolfRaceGameView connection={connection} state={state} selfSessionId="host-session" />);
    expect(screen.getByText("Alice wins!")).toBeInTheDocument();
    expect(screen.getByText("#1")).toBeInTheDocument();
    expect(screen.getByText("10 pts")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Play again" }));
    expect(sent).toContainEqual({ type: "play_again", payload: {} });
  });

  it("shows round results with standings and points", () => {
    const state = makeGolfRaceState("round-result", {
      aliceMatchPoints: 7,
      bobMatchPoints: 3,
    });
    const { connection } = makeRoomConnection(state);
    render(<GolfRaceGameView connection={connection} state={state} selfSessionId="host-session" />);
    expect(screen.getByText("Round 1 result")).toBeInTheDocument();
    expect(screen.getByText("Alice won the round")).toBeInTheDocument();
    expect(screen.getByText("7 pts")).toBeInTheDocument();
    expect(screen.getByText("3 pts")).toBeInTheDocument();
  });

  it("identifies players ranked by the round deadline", () => {
    const state = makeGolfRaceState("round-result");
    const bob = state.players.get("bob-session");
    if (bob === undefined) {
      throw new Error("missing Bob fixture");
    }
    bob.timedOut = true;
    const { connection } = makeRoomConnection(state);

    render(<GolfRaceGameView connection={connection} state={state} selfSessionId="host-session" />);

    expect(screen.getByText("timed out")).toBeInTheDocument();
  });

  it("keeps the arena container overflow hidden for 320px layouts", () => {
    const state = makeGolfRaceState("aiming");
    const { connection } = makeRoomConnection(state);
    const { container } = render(
      <ArenaView connection={connection} state={state} selfSessionId="host-session" />,
    );
    expect(container.querySelector("main")).toHaveStyle({
      position: "relative",
      overflow: "hidden",
    });
  });
});
