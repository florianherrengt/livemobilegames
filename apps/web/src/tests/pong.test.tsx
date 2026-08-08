import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ArenaView } from "../games/pong/arena-view.js";
import { makePongResult, makePongState, makeRoomConnection } from "../games/pong/fixtures.js";
import { PongGameView } from "../games/pong/game-view.js";

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
    rotate: vi.fn(),
    scale: vi.fn(),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    setLineDash: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

describe("PongGameView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(createMockContext());
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows the waiting lobby before a match", () => {
    const state = makePongState("lobby");
    const { connection } = makeRoomConnection(state);
    render(<PongGameView connection={connection} state={state} selfSessionId="host-session" />);
    expect(screen.getByText("Players (2)")).toBeInTheDocument();
    expect(
      screen.getByText("Waiting for everyone to join, then the next match starts automatically."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Play again" })).not.toBeInTheDocument();
  });

  it("shows the countdown, how-to, and the local defended edge", () => {
    const state = makePongState("countdown");
    const { connection } = makeRoomConnection(state);
    render(<PongGameView connection={connection} state={state} selfSessionId="host-session" />);
    expect(screen.getByText("How to play Four-Sided Pong")).toBeInTheDocument();
    expect(screen.getByText("Get ready")).toBeInTheDocument();
    expect(screen.getByText("You defend the bottom edge.")).toBeInTheDocument();
    expect(screen.getByTestId("pong-arena")).toHaveAttribute("data-local-edge", "bottom");
  });

  it("hides the how-to once the match is running", () => {
    const state = makePongState("running");
    const { connection } = makeRoomConnection(state);
    const { rerender } = render(
      <PongGameView connection={connection} state={state} selfSessionId="host-session" />,
    );
    rerender(
      <PongGameView
        connection={connection}
        state={makePongState("running")}
        selfSessionId="host-session"
      />,
    );
    expect(screen.queryByText("How to play Four-Sided Pong")).not.toBeInTheDocument();
  });

  it("shows GO when the countdown is about to finish", () => {
    const state = makePongState("countdown");
    state.countdownEndsAt = Date.now() - 100;
    const { connection } = makeRoomConnection(state);
    render(<PongGameView connection={connection} state={state} selfSessionId="host-session" />);
    expect(screen.getByText("GO!")).toBeInTheDocument();
  });

  it("moves the paddle by touching the screen left or right of centre", () => {
    const state = makePongState("running");
    const { connection, sent } = makeRoomConnection(state);
    render(<ArenaView connection={connection} state={state} selfSessionId="host-session" />);
    const arena = screen.getByTestId("pong-arena");
    const rect = { left: 0, width: 200 };
    vi.spyOn(arena, "getBoundingClientRect").mockReturnValue({
      ...rect,
      top: 0,
      right: 200,
      bottom: 400,
      height: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(arena, { pointerId: 1, pointerType: "touch", clientX: 40 });
    expect(arena).toHaveAttribute("data-direction", "left");
    fireEvent.pointerMove(arena, { pointerId: 1, pointerType: "touch", clientX: 160 });
    expect(arena).toHaveAttribute("data-direction", "right");
    fireEvent.pointerUp(arena, { pointerId: 1, pointerType: "touch", clientX: 160 });
    expect(sent).toContainEqual({
      type: "game:paddle-move",
      payload: { type: "paddle_move", sequence: 1, target: 0 },
    });
    expect(sent).toContainEqual({
      type: "game:paddle-move",
      payload: { type: "paddle_move", sequence: 2, target: 1 },
    });
    expect(sent).toContainEqual({
      type: "game:paddle-stop",
      payload: { type: "paddle_stop", sequence: 3 },
    });
  });

  it("maps screen-left and screen-right correctly for a rotated top-edge player", () => {
    const state = makePongState("running");
    const { connection, sent } = makeRoomConnection(state);
    render(<ArenaView connection={connection} state={state} selfSessionId="bob-session" />);
    const arena = screen.getByTestId("pong-arena");
    vi.spyOn(arena, "getBoundingClientRect").mockReturnValue({
      left: 0,
      width: 200,
      top: 0,
      right: 200,
      bottom: 400,
      height: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(arena, { pointerId: 1, pointerType: "touch", clientX: 40 });
    fireEvent.pointerMove(arena, { pointerId: 1, pointerType: "touch", clientX: 160 });
    fireEvent.pointerUp(arena, { pointerId: 1, pointerType: "touch", clientX: 160 });

    expect(sent).toContainEqual({
      type: "game:paddle-move",
      payload: { type: "paddle_move", sequence: 1, target: 1 },
    });
    expect(sent).toContainEqual({
      type: "game:paddle-move",
      payload: { type: "paddle_move", sequence: 2, target: 0 },
    });
  });

  it("supports keyboard movement and stops on key release", () => {
    const state = makePongState("running");
    const { connection, sent } = makeRoomConnection(state);
    render(<ArenaView connection={connection} state={state} selfSessionId="host-session" />);
    const arena = screen.getByTestId("pong-arena");
    fireEvent.keyDown(arena, { key: "ArrowRight" });
    fireEvent.keyUp(arena, { key: "ArrowRight" });
    expect(sent).toContainEqual({
      type: "game:paddle-move",
      payload: { type: "paddle_move", sequence: 1, target: 1 },
    });
    expect(sent).toContainEqual({
      type: "game:paddle-stop",
      payload: { type: "paddle_stop", sequence: 2 },
    });
  });

  it("does not stop the paddle when the pointer leaves the screen", () => {
    const state = makePongState("running");
    const { connection, sent } = makeRoomConnection(state);
    render(<ArenaView connection={connection} state={state} selfSessionId="host-session" />);
    const arena = screen.getByTestId("pong-arena");
    vi.spyOn(arena, "getBoundingClientRect").mockReturnValue({
      left: 0,
      width: 200,
      top: 0,
      right: 200,
      bottom: 400,
      height: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(arena, { pointerId: 1, pointerType: "touch", clientX: 40 });
    fireEvent.pointerMove(arena, { pointerId: 1, pointerType: "touch", clientX: 160 });
    fireEvent.pointerLeave(arena, { pointerId: 1, pointerType: "touch", clientX: 160 });
    expect(sent.filter((message) => message.type === "game:paddle-stop")).toHaveLength(0);
  });

  it("disables input while reconnecting", () => {
    const state = makePongState("running", { aliceReconnecting: true });
    const { connection, sent } = makeRoomConnection(state);
    render(<ArenaView connection={connection} state={state} selfSessionId="host-session" />);
    expect(screen.getByTestId("pong-arena")).toHaveAttribute("aria-disabled", "true");
    fireEvent.keyDown(screen.getByTestId("pong-arena"), { key: "ArrowLeft" });
    expect(sent).toHaveLength(0);
  });

  it("disables input while the room transport is reconnecting", () => {
    const state = makePongState("running");
    const { connection, sent } = makeRoomConnection(state);
    Object.assign(connection, { reconnecting: true });
    render(<ArenaView connection={connection} state={state} selfSessionId="host-session" />);

    expect(screen.getByTestId("pong-arena")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Reconnecting…")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId("pong-arena"), { key: "ArrowLeft" });
    expect(sent).toHaveLength(0);
  });

  it("clears an active pointer so controls recover after reconnect", () => {
    const state = makePongState("running");
    const { connection, sent } = makeRoomConnection(state);
    const { rerender } = render(
      <ArenaView connection={connection} state={state} selfSessionId="host-session" />,
    );
    const arena = screen.getByTestId("pong-arena");
    vi.spyOn(arena, "getBoundingClientRect").mockReturnValue({
      left: 0,
      width: 200,
      top: 0,
      right: 200,
      bottom: 400,
      height: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(arena, { pointerId: 1, pointerType: "touch", clientX: 40 });

    Object.assign(connection, { reconnecting: true });
    rerender(<ArenaView connection={connection} state={state} selfSessionId="host-session" />);
    Object.assign(connection, { reconnecting: false });
    rerender(<ArenaView connection={connection} state={state} selfSessionId="host-session" />);

    const recoveredArena = screen.getByTestId("pong-arena");
    vi.spyOn(recoveredArena, "getBoundingClientRect").mockReturnValue({
      left: 0,
      width: 200,
      top: 0,
      right: 200,
      bottom: 400,
      height: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(recoveredArena, {
      pointerId: 2,
      pointerType: "touch",
      clientX: 160,
    });

    expect(sent).toContainEqual({
      type: "game:paddle-move",
      payload: { type: "paddle_move", sequence: 2, target: 1 },
    });
  });

  it("shows scores, the leader marker, and the target score", () => {
    const state = makePongState("running", { aliceScore: 4, bobScore: 2 });
    const { connection } = makeRoomConnection(state);
    render(<PongGameView connection={connection} state={state} selfSessionId="host-session" />);
    expect(screen.getByText("First to 10")).toBeInTheDocument();
    expect(screen.getByText("Alice (you)")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("Lead")).toBeInTheDocument();
  });

  it("shows a brief +1 pulse for the scorer and no pulse for a neutral goal", () => {
    const scored = makePongState("running", {
      lastGoalScorerSessionId: "host-session",
      lastGoalDefenderSessionId: "bob-session",
      lastGoalAt: Date.now(),
    });
    const { connection } = makeRoomConnection(scored);
    const { rerender } = render(
      <ArenaView connection={connection} state={scored} selfSessionId="host-session" />,
    );
    expect(screen.getByText("+1")).toBeInTheDocument();
    const neutral = makePongState("running", {
      lastGoalScorerSessionId: "",
      lastGoalDefenderSessionId: "bob-session",
      lastGoalAt: Date.now(),
    });
    rerender(<ArenaView connection={connection} state={neutral} selfSessionId="host-session" />);
    expect(screen.queryByText("+1")).not.toBeInTheDocument();
  });

  it("renders the final leaderboard and lets the host play again", () => {
    const state = makePongState("finished", { result: makePongResult() });
    const { connection, sent } = makeRoomConnection(state);
    render(<PongGameView connection={connection} state={state} selfSessionId="host-session" />);
    expect(screen.getByText("Alice wins!")).toBeInTheDocument();
    expect(screen.getByText("#1")).toBeInTheDocument();
    expect(screen.getByText("10 points")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Play again" }));
    expect(sent).toContainEqual({ type: "play_again", payload: {} });
  });

  it("keeps the winner headline after the winner permanently leaves", () => {
    const state = makePongState("finished", {
      hostSessionId: "bob-session",
      result: makePongResult(),
    });
    state.players.delete("host-session");
    const { connection } = makeRoomConnection(state);

    render(<PongGameView connection={connection} state={state} selfSessionId="bob-session" />);

    expect(screen.getByText("Alice wins!")).toBeInTheDocument();
  });

  it("builds a singleton first-to-ten winner with a ranked runner-up", () => {
    const result = makePongResult({ bobScore: 9 });
    expect([...result.winnerSessionIds]).toEqual(["host-session"]);
    expect([...result.leaderboard].map((entry) => [entry.rank, entry.score])).toEqual([
      [1, 10],
      [2, 9],
    ]);
  });

  it("keeps the arena overflow hidden for 320px layouts", () => {
    const state = makePongState("running");
    const { connection } = makeRoomConnection(state);
    render(<ArenaView connection={connection} state={state} selfSessionId="host-session" />);
    expect(screen.getByTestId("pong-arena")).toHaveStyle({
      display: "flex",
      flexDirection: "column",
      height: "100dvh",
      width: "100%",
    });
  });
});
