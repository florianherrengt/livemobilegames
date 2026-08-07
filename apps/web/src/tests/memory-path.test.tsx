import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryPathArenaView } from "../games/memory-path/arena-view.js";
import {
  makeMemoryPathMatchResult,
  makeMemoryPathRoundResult,
  makeMemoryPathState,
  makeRoomConnection,
} from "../games/memory-path/fixtures.js";
import { MemoryPathGameView } from "../games/memory-path/game-view.js";

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
    lineCap: "",
    lineJoin: "",
    font: "",
    textAlign: "",
    textBaseline: "",
    globalAlpha: 1,
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
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    fillText: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

describe("MemoryPathGameView", () => {
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
    const state = makeMemoryPathState("lobby");
    const { connection } = makeRoomConnection(state);
    render(
      <MemoryPathGameView connection={connection} state={state} selfSessionId="host-session" />,
    );
    expect(screen.getByText("Players (2)")).toBeInTheDocument();
    expect(
      screen.getByText("Waiting for everyone to join, then the match starts automatically."),
    ).toBeInTheDocument();
  });

  it("shows the preview with the path visible and movement locked", () => {
    const state = makeMemoryPathState("preview");
    const { connection, sent } = makeRoomConnection(state);
    render(
      <MemoryPathArenaView
        connection={connection}
        state={state}
        selfSessionId="host-session"
        roomError={null}
      />,
    );
    const arena = screen.getByTestId("memory-path-arena");
    expect(arena).toHaveAttribute("data-phase", "preview");
    expect(arena).toHaveAttribute("data-path-visible", "true");
    expect(arena).toHaveAttribute("data-can-move", "false");
    fireEvent.keyDown(window, { key: "ArrowUp" });
    fireEvent.keyUp(window, { key: "ArrowUp" });
    expect(sent).toHaveLength(0);
  });

  it("hides opponents and the path while racing and shows the timer", () => {
    const state = makeMemoryPathState("racing");
    const { connection } = makeRoomConnection(state);
    render(
      <MemoryPathArenaView
        connection={connection}
        state={state}
        selfSessionId="host-session"
        roomError={null}
      />,
    );
    const arena = screen.getByTestId("memory-path-arena");
    expect(arena).toHaveAttribute("data-path-visible", "false");
    expect(arena).toHaveAttribute("data-opponents-visible", "false");
    expect(arena).toHaveAttribute("data-can-move", "true");
    expect(screen.getByTestId("memory-path-timer")).toBeInTheDocument();
  });

  it("shows the path and opponents during a flash", () => {
    const state = makeMemoryPathState("racing", {
      pathVisible: true,
      opponentsVisible: true,
    });
    const { connection } = makeRoomConnection(state);
    render(
      <MemoryPathArenaView
        connection={connection}
        state={state}
        selfSessionId="host-session"
        roomError={null}
      />,
    );
    expect(screen.getByTestId("memory-path-arena")).toHaveAttribute("data-path-visible", "true");
    expect(screen.getByTestId("memory-path-arena")).toHaveAttribute(
      "data-opponents-visible",
      "true",
    );
  });

  it("sends joystick intentions from the arrow keys while racing", () => {
    const state = makeMemoryPathState("racing");
    const { connection, sent } = makeRoomConnection(state);
    render(
      <MemoryPathArenaView
        connection={connection}
        state={state}
        selfSessionId="host-session"
        roomError={null}
      />,
    );
    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(sent).toContainEqual({
      type: "game:move",
      payload: { type: "move", sequence: 1, roundNumber: 1, x: 0, y: -1 },
    });
    fireEvent.keyUp(window, { key: "ArrowUp" });
    expect(sent).toContainEqual({
      type: "game:move",
      payload: { type: "move", sequence: 2, roundNumber: 1, x: 0, y: 0 },
    });
  });

  it("sends joystick intentions from the on-screen movement stick", () => {
    const state = makeMemoryPathState("racing");
    const { connection, sent } = makeRoomConnection(state);
    render(
      <MemoryPathArenaView
        connection={connection}
        state={state}
        selfSessionId="host-session"
        roomError={null}
      />,
    );
    const stick = screen.getByTestId("memory-path-joystick");
    vi.spyOn(stick, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 148,
      bottom: 148,
      width: 148,
      height: 148,
      toJSON: () => ({}),
    } as DOMRect);
    Object.defineProperty(stick, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });

    fireEvent.pointerDown(stick, {
      pointerId: 1,
      pointerType: "touch",
      button: 0,
      clientX: 74,
      clientY: 74,
    });
    fireEvent.pointerMove(stick, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 124,
      clientY: 74,
    });
    fireEvent.pointerUp(stick, { pointerId: 1, pointerType: "touch" });

    expect(sent.some((entry) => entry.type === "game:move")).toBe(true);
    const movement = sent.find((entry) => entry.type === "game:move");
    expect(movement?.payload).toMatchObject({
      type: "move",
      roundNumber: 1,
    });
    const stop = sent[sent.length - 1];
    expect(stop?.payload).toMatchObject({ x: 0, y: 0 });
  });

  it("does not send movement while spectating sudden death", () => {
    const state = makeMemoryPathState("racing", {
      suddenDeath: true,
      aliceActive: true,
      bobActive: false,
    });
    const { connection, sent } = makeRoomConnection(state);
    render(
      <MemoryPathArenaView
        connection={connection}
        state={state}
        selfSessionId="bob-session"
        roomError={null}
      />,
    );
    expect(screen.getByText("Spectating")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    fireEvent.keyUp(window, { key: "ArrowLeft" });
    expect(sent).toHaveLength(0);
  });

  it("shows a fall and resets local movement status", () => {
    const state = makeMemoryPathState("racing", { aliceFalling: true });
    const { connection } = makeRoomConnection(state);
    render(
      <MemoryPathArenaView
        connection={connection}
        state={state}
        selfSessionId="host-session"
        roomError={null}
      />,
    );
    expect(screen.getByText("Back to the start…")).toBeInTheDocument();
    expect(screen.getByTestId("memory-path-arena")).toHaveAttribute("data-falling", "true");
  });

  it("shows the round result with the winner and updated wins", () => {
    const state = makeMemoryPathState("round-result", {
      roundResult: makeMemoryPathRoundResult(),
      aliceRoundWins: 2,
      bobRoundWins: 1,
    });
    const { connection } = makeRoomConnection(state);
    render(
      <MemoryPathGameView connection={connection} state={state} selfSessionId="host-session" />,
    );
    expect(screen.getByText("Round 1 result")).toBeInTheDocument();
    expect(screen.getByText("Alice reached the finish first.")).toBeInTheDocument();
    expect(screen.getByText("2 wins")).toBeInTheDocument();
    expect(screen.getByText("1 win")).toBeInTheDocument();
  });

  it("renders the final scoreboard and lets the host play again", () => {
    const state = makeMemoryPathState("match-result", {
      matchResult: makeMemoryPathMatchResult(),
      aliceRoundWins: 3,
      bobRoundWins: 0,
    });
    const { connection, sent } = makeRoomConnection(state);
    render(
      <MemoryPathGameView connection={connection} state={state} selfSessionId="host-session" />,
    );
    expect(screen.getByText("Alice wins the match!")).toBeInTheDocument();
    expect(screen.getByTestId("memory-path-leaderboard")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Play again" }));
    expect(sent).toContainEqual({ type: "play_again", payload: {} });
  });

  it("keeps the arena overflow hidden for 320px layouts", () => {
    const state = makeMemoryPathState("racing");
    const { connection } = makeRoomConnection(state);
    render(
      <MemoryPathArenaView
        connection={connection}
        state={state}
        selfSessionId="host-session"
        roomError={null}
      />,
    );
    expect(screen.getByTestId("memory-path-arena")).toHaveStyle({
      overflow: "hidden",
      position: "relative",
    });
  });
});
