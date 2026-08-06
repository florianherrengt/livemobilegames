import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ArenaView, extrapolateBirdY } from "../games/flappy-race/arena-view.js";
import {
  makeFlappyRaceResult,
  makeFlappyRaceState,
  makeRoomConnection,
} from "../games/flappy-race/fixtures.js";
import { FlappyRaceGameView } from "../games/flappy-race/game-view.js";

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
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  } as unknown as CanvasRenderingContext2D;
}

describe("FlappyRaceGameView", () => {
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

  it("extrapolates the bird along the authoritative velocity and clamps it", () => {
    expect(extrapolateBirdY(400, -430, 100)).toBeCloseTo(357, 5);
    expect(extrapolateBirdY(1, -1_000, 500)).toBe(0);
    expect(extrapolateBirdY(800, 1_000, 500)).toBe(814);
  });

  it("shows the waiting lobby before a match", () => {
    const state = makeFlappyRaceState("lobby");
    const { connection } = makeRoomConnection(state);
    render(
      <FlappyRaceGameView connection={connection} state={state} selfSessionId="host-session" />,
    );
    expect(screen.getByText("Players (2)")).toBeInTheDocument();
    expect(
      screen.getByText("Waiting for everyone to join, then the next match starts automatically."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Play again" })).not.toBeInTheDocument();
  });

  it("shows the countdown phase with every player", () => {
    const state = makeFlappyRaceState("countdown");
    const { connection } = makeRoomConnection(state);
    render(
      <FlappyRaceGameView connection={connection} state={state} selfSessionId="host-session" />,
    );
    expect(screen.getByText("Round 1")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("shows the how-to during countdown and hides it once running", () => {
    const state = makeFlappyRaceState("countdown");
    const { connection } = makeRoomConnection(state);
    const { rerender } = render(
      <FlappyRaceGameView connection={connection} state={state} selfSessionId="host-session" />,
    );
    expect(screen.getByText("How to play Flappy Race")).toBeInTheDocument();
    rerender(
      <FlappyRaceGameView
        connection={connection}
        state={makeFlappyRaceState("running")}
        selfSessionId="host-session"
      />,
    );
    expect(screen.queryByText("How to play Flappy Race")).not.toBeInTheDocument();
  });

  it("sends a flap intent from the accessible flap button", () => {
    const state = makeFlappyRaceState("running");
    const { connection, sent } = makeRoomConnection(state);
    render(<ArenaView connection={connection} state={state} selfSessionId="host-session" />);
    fireEvent.click(screen.getByTestId("flappy-flap-button"));
    expect(feedback.gameFeedback).toHaveBeenCalledWith("move");
    expect(sent).toContainEqual({
      type: "game:flap",
      payload: { type: "flap", sequence: 1, roundNumber: 1 },
    });
  });

  it("sends a flap intent from a tap on the course", () => {
    const state = makeFlappyRaceState("running");
    const { connection, sent } = makeRoomConnection(state);
    const { container } = render(
      <ArenaView connection={connection} state={state} selfSessionId="host-session" />,
    );
    const arena = container.querySelector("[data-testid='flappy-race-arena']");
    if (!arena) {
      throw new Error("arena missing");
    }
    fireEvent.pointerDown(arena, { pointerType: "touch" });
    expect(sent).toContainEqual({
      type: "game:flap",
      payload: { type: "flap", sequence: 1, roundNumber: 1 },
    });
  });

  it("disables input while spectating", () => {
    const state = makeFlappyRaceState("running", { aliceActive: false, bobActive: true });
    const { connection, sent } = makeRoomConnection(state);
    render(<ArenaView connection={connection} state={state} selfSessionId="host-session" />);
    expect(screen.getByTestId("flappy-flap-button")).toBeDisabled();
    expect(screen.getByTestId("flappy-race-arena")).toHaveAttribute("data-spectating", "true");
    expect(sent).toHaveLength(0);
  });

  it("shows an honest reconnecting state while the socket is dropped", () => {
    const state = makeFlappyRaceState("running", { aliceReconnecting: true });
    const { connection } = makeRoomConnection(state);
    render(<ArenaView connection={connection} state={state} selfSessionId="host-session" />);
    expect(screen.getByText("Reconnecting…")).toBeInTheDocument();
  });

  it("shows the round result overlay with winners and scores", () => {
    const state = makeFlappyRaceState("round-result");
    const { connection } = makeRoomConnection(state);
    render(
      <FlappyRaceGameView connection={connection} state={state} selfSessionId="host-session" />,
    );
    expect(screen.getByText("Round 1 result")).toBeInTheDocument();
    expect(screen.getByText("Alice wins the round")).toBeInTheDocument();
    expect(screen.getAllByText("0 wins").length).toBeGreaterThanOrEqual(2);
  });

  it("renders the final leaderboard and lets the host play again", () => {
    const state = makeFlappyRaceState("finished", { result: makeFlappyRaceResult() });
    const { connection, sent } = makeRoomConnection(state);
    render(
      <FlappyRaceGameView connection={connection} state={state} selfSessionId="host-session" />,
    );
    expect(screen.getByText("Alice wins!")).toBeInTheDocument();
    expect(screen.getByText("#1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Play again" }));
    expect(sent).toContainEqual({ type: "play_again", payload: {} });
  });

  it("builds a tied result with shared rank and score", () => {
    const result = makeFlappyRaceResult({ tie: true });
    expect(result.winnerSessionIds).toHaveLength(2);
    expect(
      [...result.leaderboard].every((entry) => entry.rank === 1 && entry.primaryScore === 5),
    ).toBe(true);
  });

  it("keeps the arena container overflow hidden for 320px layouts", () => {
    const state = makeFlappyRaceState("running");
    const { connection } = makeRoomConnection(state);
    render(<ArenaView connection={connection} state={state} selfSessionId="host-session" />);
    expect(screen.getByTestId("flappy-race-arena")).toHaveStyle({
      overflow: "hidden",
      position: "relative",
    });
  });
});
