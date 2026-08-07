import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ArenaView,
  cellCenterLeft,
  cellCenterTop,
  rowToTop,
} from "../games/coin-rush/arena-view.js";
import {
  makeCoinRushResult,
  makeCoinRushState,
  makeRoomConnection,
} from "../games/coin-rush/fixtures.js";
import { CoinRushGameView } from "../games/coin-rush/game-view.js";

const feedback = vi.hoisted(() => ({
  gameFeedback: vi.fn(),
  hapticFeedback: vi.fn(),
  primeGameFeedback: vi.fn(),
}));

vi.mock("../feedback.js", () => feedback);

describe("CoinRushGameView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows the waiting lobby before a match", () => {
    const state = makeCoinRushState("lobby");
    const { connection } = makeRoomConnection(state);
    render(<CoinRushGameView connection={connection} state={state} selfSessionId="host-session" />);
    expect(screen.getByText("Players (2)")).toBeInTheDocument();
    expect(
      screen.getByText("Waiting for everyone to join, then the first round starts automatically."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Play again" })).not.toBeInTheDocument();
  });

  it("renders row zero at the bottom and higher rows toward the top", () => {
    expect(rowToTop(0)).toBeGreaterThan(rowToTop(1));
    expect(rowToTop(16)).toBe(0);
    expect(rowToTop(0)).toBeCloseTo(94.1176, 3);
  });

  it("places tokens in the centre of grid squares, not on intersections", () => {
    expect(cellCenterLeft(0)).toBeCloseTo(5.5556, 3);
    expect(cellCenterLeft(8)).toBeCloseTo(94.4444, 3);
    expect(cellCenterTop(0)).toBeCloseTo(97.0588, 3);
    expect(cellCenterTop(16)).toBeCloseTo(2.9412, 3);
  });

  it("shows the countdown phase with the how-to card", () => {
    const state = makeCoinRushState("countdown");
    const { connection } = makeRoomConnection(state);
    render(<CoinRushGameView connection={connection} state={state} selfSessionId="host-session" />);
    expect(screen.getByText("How to play Coin Rush")).toBeInTheDocument();
    expect(screen.getByText("Round 1")).toBeInTheDocument();
    expect(screen.getAllByText(/Alice/).length).toBeGreaterThan(0);
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("renders the full board and every coin value during play", () => {
    const state = makeCoinRushState("playing");
    const { connection } = makeRoomConnection(state);
    render(<ArenaView connection={connection} state={state} selfSessionId="host-session" />);
    const arena = screen.getByTestId("coin-rush-arena");
    expect(arena).toHaveAttribute("data-phase", "playing");
    expect(arena).toHaveAttribute("data-coins");
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("Swipe to jump")).toBeInTheDocument();
    expect(screen.getByTestId("coin-rush-scoreboard").textContent).toContain("Alice 0 · 0w");
    expect(screen.getByTestId("coin-rush-scoreboard").textContent).toContain("Bob 0 · 0w");
  });

  it("sends a swipe intent from a pointer gesture", () => {
    const state = makeCoinRushState("playing");
    const { connection, sent } = makeRoomConnection(state);
    const { container } = render(
      <ArenaView connection={connection} state={state} selfSessionId="host-session" />,
    );
    const arena = container.querySelector("[data-testid='coin-rush-arena']");
    if (!arena) {
      throw new Error("arena missing");
    }
    fireEvent.pointerDown(arena, {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
      pointerType: "touch",
    });
    fireEvent.pointerMove(arena, {
      pointerId: 1,
      clientX: 140,
      clientY: 100,
      pointerType: "touch",
    });
    fireEvent.pointerUp(arena, { pointerId: 1, clientX: 140, clientY: 100, pointerType: "touch" });
    expect(feedback.gameFeedback).toHaveBeenCalledWith("move");
    expect(sent).toContainEqual({
      type: "game:move",
      payload: { type: "move", sequence: 1, direction: "right" },
    });
  });

  it("maps a downward swipe to down and an upward swipe to up", () => {
    const downState = makeCoinRushState("playing");
    const downConnection = makeRoomConnection(downState);
    const downContainer = render(
      <ArenaView
        connection={downConnection.connection}
        state={downState}
        selfSessionId="host-session"
      />,
    ).container;
    const downArena = downContainer.querySelector("[data-testid='coin-rush-arena']");
    if (!downArena) {
      throw new Error("arena missing");
    }
    fireEvent.pointerDown(downArena, {
      pointerId: 3,
      clientX: 100,
      clientY: 100,
      pointerType: "touch",
    });
    fireEvent.pointerMove(downArena, {
      pointerId: 3,
      clientX: 100,
      clientY: 160,
      pointerType: "touch",
    });
    fireEvent.pointerUp(downArena, {
      pointerId: 3,
      clientX: 100,
      clientY: 160,
      pointerType: "touch",
    });
    expect(downConnection.sent).toContainEqual({
      type: "game:move",
      payload: { type: "move", sequence: 1, direction: "down" },
    });

    const upState = makeCoinRushState("playing");
    const upConnection = makeRoomConnection(upState);
    const upContainer = render(
      <ArenaView
        connection={upConnection.connection}
        state={upState}
        selfSessionId="host-session"
      />,
    ).container;
    const upArena = upContainer.querySelector("[data-testid='coin-rush-arena']");
    if (!upArena) {
      throw new Error("arena missing");
    }
    fireEvent.pointerDown(upArena, {
      pointerId: 4,
      clientX: 100,
      clientY: 160,
      pointerType: "touch",
    });
    fireEvent.pointerMove(upArena, {
      pointerId: 4,
      clientX: 100,
      clientY: 100,
      pointerType: "touch",
    });
    fireEvent.pointerUp(upArena, {
      pointerId: 4,
      clientX: 100,
      clientY: 100,
      pointerType: "touch",
    });
    expect(upConnection.sent).toContainEqual({
      type: "game:move",
      payload: { type: "move", sequence: 1, direction: "up" },
    });
  });

  it("buffers one direction while moving and sends it when the server clears the move", () => {
    const state = makeCoinRushState("playing");
    const { connection, sent } = makeRoomConnection(state);
    const { rerender } = render(
      <ArenaView connection={connection} state={state} selfSessionId="host-session" />,
    );
    const local = state.players.get("host-session");
    if (!local) {
      throw new Error("missing local player");
    }
    local.moving = true;
    rerender(<ArenaView connection={connection} state={state} selfSessionId="host-session" />);
    const arena = screen.getByTestId("coin-rush-arena");
    fireEvent.pointerDown(arena, {
      pointerId: 2,
      clientX: 120,
      clientY: 120,
      pointerType: "touch",
    });
    fireEvent.pointerMove(arena, { pointerId: 2, clientX: 80, clientY: 120, pointerType: "touch" });
    fireEvent.pointerUp(arena, { pointerId: 2, clientX: 80, clientY: 120, pointerType: "touch" });
    expect(sent).toHaveLength(0);

    local.moving = false;
    rerender(<ArenaView connection={connection} state={state} selfSessionId="host-session" />);
    expect(sent).toContainEqual({
      type: "game:move",
      payload: { type: "move", sequence: 1, direction: "left" },
    });
  });

  it("shows the round result overlay with scores", () => {
    const state = makeCoinRushState("round-result", { aliceScore: 11, bobScore: 4 });
    const { connection } = makeRoomConnection(state);
    render(<CoinRushGameView connection={connection} state={state} selfSessionId="host-session" />);
    expect(screen.getByText("Round 1 result")).toBeInTheDocument();
    expect(screen.getByText("Alice wins the round")).toBeInTheDocument();
    expect(screen.getByText("11 pts · 0 wins")).toBeInTheDocument();
  });

  it("renders the final leaderboard and lets the host play again", () => {
    const state = makeCoinRushState("finished", {
      result: makeCoinRushResult(),
      aliceRoundWins: 2,
      bobRoundWins: 1,
    });
    const { connection, sent } = makeRoomConnection(state);
    render(<CoinRushGameView connection={connection} state={state} selfSessionId="host-session" />);
    expect(screen.getByText("Alice wins!")).toBeInTheDocument();
    expect(screen.getByTestId("coin-rush-leaderboard").textContent).toContain(
      "2 wins · 12 coins · 1 death",
    );
    fireEvent.click(screen.getByRole("button", { name: "Play again" }));
    expect(sent).toContainEqual({ type: "play_again", payload: {} });
  });

  it("shows an honest reconnecting state while the socket is dropped", () => {
    const state = makeCoinRushState("playing");
    const local = state.players.get("host-session");
    if (local) {
      local.connected = false;
    }
    const { connection } = makeRoomConnection(state);
    render(<ArenaView connection={connection} state={state} selfSessionId="host-session" />);
    expect(screen.getAllByText("Reconnecting…").length).toBeGreaterThan(0);
  });

  it("shows a short +value popup when the local score increases", () => {
    const state = makeCoinRushState("playing");
    const { connection } = makeRoomConnection(state);
    const { rerender } = render(
      <ArenaView connection={connection} state={state} selfSessionId="host-session" />,
    );
    const local = state.players.get("host-session");
    if (!local) {
      throw new Error("missing local player");
    }
    local.score = 5;
    rerender(<ArenaView connection={connection} state={state} selfSessionId="host-session" />);
    expect(screen.getByText("+5")).toBeInTheDocument();
  });

  it("keeps the arena overflow hidden for 320px layouts", () => {
    const state = makeCoinRushState("playing");
    const { connection } = makeRoomConnection(state);
    render(<ArenaView connection={connection} state={state} selfSessionId="host-session" />);
    expect(screen.getByTestId("coin-rush-arena")).toHaveStyle({
      overflow: "hidden",
      position: "relative",
    });
  });
});
