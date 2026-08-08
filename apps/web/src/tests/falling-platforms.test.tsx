import { platformCenterX, platformCenterY } from "@phone-party/protocol";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ArenaView,
  fitArenaToViewport,
  fitCameraToArena,
  interpolateJumpPosition,
} from "../games/falling-platforms/arena-view.js";
import {
  makeFallingPlatformsState,
  makeRoomConnection,
} from "../games/falling-platforms/fixtures.js";
import { FallingPlatformsGameView } from "../games/falling-platforms/game-view.js";

const feedback = vi.hoisted(() => ({
  gameFeedback: vi.fn(),
  hapticFeedback: vi.fn(),
  primeGameFeedback: vi.fn(),
}));

vi.mock("../feedback.js", () => feedback);

class MockResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

describe("FallingPlatformsGameView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("interpolates a remote jump from server timestamps instead of teleporting", () => {
    const now = Date.now();
    const position = interpolateJumpPosition("3:3", "4:3", now - 180, 360, 7, now, false, {
      x: 0,
      y: 0,
    });
    expect(position.x).toBeGreaterThan(platformCenterX(3, 7));
    expect(position.x).toBeLessThan(platformCenterX(4, 7));
    expect(position.y).toBe(platformCenterY(3, 7));
    expect(position.height).toBeGreaterThan(0);
  });

  it("snaps to the target at the jump deadline and under reduced motion", () => {
    const now = Date.now();
    const landed = interpolateJumpPosition("3:3", "4:3", now - 360, 360, 7, now, false, {
      x: 0,
      y: 0,
    });
    expect(landed.x).toBe(platformCenterX(4, 7));
    expect(landed.height).toBeLessThan(0.001);

    const reduced = interpolateJumpPosition("3:3", "4:3", now - 180, 360, 7, now, true, {
      x: 0,
      y: 0,
    });
    expect(reduced.x).toBe(platformCenterX(4, 7));
    expect(reduced.height).toBe(0);
  });

  it("keeps the whole grid inside the arena viewport before the camera zoom", () => {
    const fiveByFive = fitArenaToViewport(320, 480, 5 * 116);
    expect(fiveByFive.scale).toBe(320 / (5 * 116));
    expect(fiveByFive.offsetX).toBe(0);
    expect(fiveByFive.offsetY).toBe((480 - 5 * 116 * fiveByFive.scale) / 2);

    const nineByNine = fitArenaToViewport(320, 480, 9 * 116);
    expect(9 * 116 * nineByNine.scale).toBeLessThanOrEqual(320);
    expect(9 * 116 * nineByNine.scale).toBeLessThanOrEqual(480);
    expect(nineByNine.offsetX).toBe((320 - 9 * 116 * nineByNine.scale) / 2);
  });

  it("doubles the fitted platform size and clamps the camera inside the arena", () => {
    const fit = fitCameraToArena(320, 480, 5 * 116, 116, 116);
    expect(fit.scale).toBe((320 / (5 * 116)) * 2);
    expect(fit.offsetX).toBe(160 - (116 + (5 * 116) / 2) * fit.scale);
    expect(fit.offsetY).toBe(480 - 5 * 116 * fit.scale);

    const centre = fitCameraToArena(320, 480, 5 * 116, 0, 0);
    expect(centre.offsetX).toBe((320 - 5 * 116 * centre.scale) / 2);
    expect(centre.offsetY).toBe((480 - 5 * 116 * centre.scale) / 2);
  });

  it("renders platforms at double the previous size", () => {
    const state = makeFallingPlatformsState("playing");
    const { connection } = makeRoomConnection(state);
    render(<ArenaView connection={connection} state={state} selfSessionId="host-session" />);
    const platform = screen.getByTestId("platform-3:3");
    expect(platform).toHaveStyle({ width: "104px", height: "104px" });
  });

  it("shows the waiting lobby before the first round", () => {
    const state = makeFallingPlatformsState("lobby");
    const { connection } = makeRoomConnection(state);
    render(
      <FallingPlatformsGameView
        connection={connection}
        state={state}
        selfSessionId="host-session"
      />,
    );
    expect(screen.getByText("Players (2)")).toBeInTheDocument();
    expect(
      screen.getByText("Waiting for everyone to join, then the first round starts automatically."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Play again" })).not.toBeInTheDocument();
  });

  it("lets the host play again after a completed round", () => {
    const state = makeFallingPlatformsState("lobby", { roundNumber: 1 });
    const { connection, sent } = makeRoomConnection(state);
    render(
      <FallingPlatformsGameView
        connection={connection}
        state={state}
        selfSessionId="host-session"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Play again" }));
    expect(sent).toContainEqual({ type: "play_again", payload: {} });
  });

  it("shows the countdown phase", () => {
    const state = makeFallingPlatformsState("countdown");
    const { connection } = makeRoomConnection(state);
    render(
      <FallingPlatformsGameView
        connection={connection}
        state={state}
        selfSessionId="host-session"
      />,
    );
    expect(screen.getByText("Get ready…")).toBeInTheDocument();
    expect(screen.getByText(/Round 1 starts automatically/)).toBeInTheDocument();
  });

  it("counts only connected players during the countdown", () => {
    const state = makeFallingPlatformsState("countdown", { aliceConnected: false });
    const { connection } = makeRoomConnection(state);
    render(
      <FallingPlatformsGameView
        connection={connection}
        state={state}
        selfSessionId="host-session"
      />,
    );
    expect(screen.getByText("1 player connected")).toBeInTheDocument();
    expect(screen.queryByText("2 players connected")).not.toBeInTheDocument();
  });

  it("shows the how-to during countdown and hides it once play begins", () => {
    const state = makeFallingPlatformsState("countdown");
    const { connection } = makeRoomConnection(state);
    const { rerender } = render(
      <FallingPlatformsGameView
        connection={connection}
        state={state}
        selfSessionId="host-session"
      />,
    );
    expect(screen.getByText("How to play Falling Platforms")).toBeInTheDocument();
    rerender(
      <FallingPlatformsGameView
        connection={connection}
        state={makeFallingPlatformsState("playing")}
        selfSessionId="host-session"
      />,
    );
    expect(screen.queryByText("How to play Falling Platforms")).not.toBeInTheDocument();
  });

  it("marks warning platforms and the local player clearly", () => {
    const state = makeFallingPlatformsState("playing");
    const warning = state.platforms.get("3:4");
    if (!warning) {
      throw new Error("platform missing");
    }
    warning.state = "warning";
    const { connection } = makeRoomConnection(state);
    render(<ArenaView connection={connection} state={state} selfSessionId="host-session" />);
    expect(screen.getByTestId("platform-3:4")).toHaveTextContent("!");
    expect(screen.getByTestId("player-Alice")).toHaveAttribute("data-local", "true");
    expect(screen.getByTestId("player-Bob")).toHaveAttribute("data-local", "false");
  });

  it("renders the arena with platforms and players and no swipe controls", () => {
    const state = makeFallingPlatformsState("playing");
    const { connection } = makeRoomConnection(state);
    render(<ArenaView connection={connection} state={state} selfSessionId="host-session" />);
    expect(screen.getByTestId("falling-platforms-arena")).toHaveAttribute("data-phase", "playing");
    expect(screen.getByTestId("platform-3:3")).toHaveAttribute("data-state", "stable");
    expect(screen.getByText("Alice (you)")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Hop controls" })).not.toBeInTheDocument();
  });

  it("sends a hop intent for a swipe across the arena", () => {
    const state = makeFallingPlatformsState("playing");
    const { connection, sent } = makeRoomConnection(state);
    const { container } = render(
      <ArenaView connection={connection} state={state} selfSessionId="host-session" />,
    );
    const arena = container.querySelector("[data-testid='falling-platforms-arena']");
    if (!arena) {
      throw new Error("arena missing");
    }
    fireEvent.pointerDown(arena, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(arena, { pointerId: 1, clientX: 45, clientY: 10 });
    expect(feedback.gameFeedback).toHaveBeenCalledWith("move");
    expect(sent).toContainEqual({
      type: "game:hop",
      payload: { type: "hop", sequence: 1, targetPlatformId: "4:3" },
    });
    expect(screen.getByTestId("arena-status")).not.toHaveTextContent("Hop sent");
  });

  it("buffers an airborne swipe and fires it after landing", () => {
    const state = makeFallingPlatformsState("playing", {
      alicePlatform: "2:3",
      aliceTargetPlatform: "3:3",
      aliceJumping: true,
    });
    const { connection, sent } = makeRoomConnection(state);
    const { container, rerender } = render(
      <ArenaView connection={connection} state={state} selfSessionId="host-session" />,
    );
    const arena = container.querySelector("[data-testid='falling-platforms-arena']");
    if (!arena) {
      throw new Error("arena missing");
    }
    fireEvent.pointerDown(arena, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(arena, { pointerId: 1, clientX: 45, clientY: 10 });
    expect(sent).toHaveLength(0);
    expect(screen.getByTestId("arena-status")).toHaveTextContent("Hop buffered");

    const alice = state.players.get("host-session");
    if (!alice) {
      throw new Error("Alice player missing");
    }
    alice.jumping = false;
    alice.currentPlatformId = "3:3";
    rerender(<ArenaView connection={connection} state={state} selfSessionId="host-session" />);
    expect(sent).toContainEqual({
      type: "game:hop",
      payload: { type: "hop", sequence: 1, targetPlatformId: "4:3" },
    });
  });

  it("shows the whole arena while spectating with no hop controls", () => {
    const state = makeFallingPlatformsState("playing", { aliceAlive: false });
    const { connection } = makeRoomConnection(state);
    render(<ArenaView connection={connection} state={state} selfSessionId="host-session" />);
    expect(screen.queryByRole("group", { name: "Hop controls" })).not.toBeInTheDocument();
    expect(screen.getByTestId("arena-status")).toHaveTextContent("Spectating");
    expect(screen.getByTestId("falling-platforms-arena")).toHaveAttribute(
      "data-spectating",
      "true",
    );
  });

  it("lets a spectator tap a survivor to follow them", () => {
    const state = makeFallingPlatformsState("playing", { aliceAlive: false });
    const { connection } = makeRoomConnection(state);
    const { container } = render(
      <ArenaView connection={connection} state={state} selfSessionId="host-session" />,
    );
    const arena = container.querySelector("[data-testid='falling-platforms-arena']");
    if (!arena) {
      throw new Error("arena missing");
    }
    fireEvent.pointerDown(arena, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(arena, { pointerId: 1, clientX: 10, clientY: 10 });
    expect(screen.getByTestId("arena-status")).toHaveTextContent("Following Bob");
  });

  it("shows an honest reconnecting state while the socket is dropped", () => {
    const state = makeFallingPlatformsState("playing", { aliceConnected: false });
    const { connection } = makeRoomConnection(state);
    render(<ArenaView connection={connection} state={state} selfSessionId="host-session" />);
    expect(screen.getAllByText("Reconnecting…").length).toBeGreaterThan(0);
  });

  it("shows the winner and draw headlines on results", () => {
    const winnerState = makeFallingPlatformsState("results", { winnerSessionId: "host-session" });
    const winnerConnection = makeRoomConnection(winnerState).connection;
    const { unmount } = render(
      <FallingPlatformsGameView
        connection={winnerConnection}
        state={winnerState}
        selfSessionId="host-session"
      />,
    );
    expect(screen.getByText("Alice wins!")).toBeInTheDocument();
    unmount();

    const drawState = makeFallingPlatformsState("results", { draw: true });
    const drawConnection = makeRoomConnection(drawState).connection;
    render(
      <FallingPlatformsGameView
        connection={drawConnection}
        state={drawState}
        selfSessionId="host-session"
      />,
    );
    expect(screen.getByText("It's a draw")).toBeInTheDocument();
  });

  it("keeps the arena container overflow hidden for 320px layouts", () => {
    const state = makeFallingPlatformsState("playing");
    const { connection } = makeRoomConnection(state);
    render(<ArenaView connection={connection} state={state} selfSessionId="host-session" />);
    expect(screen.getByTestId("falling-platforms-arena")).toHaveStyle({
      overflow: "hidden",
      position: "relative",
    });
  });
});
