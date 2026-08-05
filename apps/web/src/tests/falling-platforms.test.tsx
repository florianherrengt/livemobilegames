import { platformCenterX, platformCenterY } from "@phone-party/protocol";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArenaView, interpolateJumpPosition } from "../games/falling-platforms/arena-view.js";
import {
  makeFallingPlatformsState,
  makeRoomConnection,
} from "../games/falling-platforms/fixtures.js";
import { FallingPlatformsGameView } from "../games/falling-platforms/game-view.js";

class MockResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

describe("FallingPlatformsGameView", () => {
  beforeEach(() => {
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
    expect(sent).toContainEqual({
      type: "game:hop",
      payload: { type: "hop", sequence: 1, targetPlatformId: "4:3" },
    });
  });

  it("buffers an airborne swipe and fires it after landing", () => {
    const state = makeFallingPlatformsState("playing", {
      alicePlatform: "3:3",
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
    alice.currentPlatformId = "4:3";
    rerender(<ArenaView connection={connection} state={state} selfSessionId="host-session" />);
    expect(sent).toContainEqual({
      type: "game:hop",
      payload: { type: "hop", sequence: 1, targetPlatformId: "5:3" },
    });
  });

  it("follows a survivor while spectating with no hop controls", () => {
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
