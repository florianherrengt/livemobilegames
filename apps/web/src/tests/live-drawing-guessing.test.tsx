import {
  LIVE_DRAWING_GUESSING_MESSAGE_TYPES,
  type LiveDrawingGuessingState,
} from "@phone-party/protocol";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  makeLiveDrawingGuessingState,
  makeRoomConnection,
} from "../games/live-drawing-guessing/fixtures.js";
import { LiveDrawingGuessingGameView } from "../games/live-drawing-guessing/game-view.js";

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
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    lineCap: "",
    lineJoin: "",
  } as unknown as CanvasRenderingContext2D;
}

function renderGame(state: LiveDrawingGuessingState, selfSessionId = "alice-session") {
  const fixture = makeRoomConnection(state, selfSessionId);
  render(
    <LiveDrawingGuessingGameView
      connection={fixture.connection}
      state={state}
      selfSessionId={selfSessionId}
    />,
  );
  return fixture;
}

describe("LiveDrawingGuessingGameView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(createMockContext());
    vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 320,
      bottom: 400,
      width: 320,
      height: 400,
      toJSON: () => ({}),
    } as DOMRect);
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows the waiting lobby before a match", () => {
    const state = makeLiveDrawingGuessingState("lobby");
    renderGame(state);
    expect(screen.getByText("Players (2)")).toBeInTheDocument();
    expect(
      screen.getByText("Waiting for everyone to join, then the first turn starts automatically."),
    ).toBeInTheDocument();
  });

  it("shows the drawer the private word and category from the briefing", () => {
    const state = makeLiveDrawingGuessingState("preparing");
    const { emit } = renderGame(state);
    expect(screen.getByTestId("ldg-drawer-word")).toHaveTextContent("…");
    act(() => {
      emit(LIVE_DRAWING_GUESSING_MESSAGE_TYPES.drawerBriefing, {
        word: "penguin",
        category: "Animal",
        turnNumber: 1,
        roundNumber: 1,
        letterCount: 7,
      });
    });
    expect(screen.getByTestId("ldg-drawer-word")).toHaveTextContent("penguin");
    expect(screen.getByText("Category: Animal")).toBeInTheDocument();
    expect(screen.getByText("How to play Live Drawing & Guessing")).toBeInTheDocument();
  });

  it("discards a stale drawer briefing and requests the word for a later turn", () => {
    const firstTurn = makeLiveDrawingGuessingState("preparing", {
      drawerPlayerId: "alice",
      turnNumber: 1,
      roundNumber: 1,
    });
    const fixture = makeRoomConnection(firstTurn, "alice-session");
    const { rerender } = render(
      <LiveDrawingGuessingGameView
        connection={fixture.connection}
        state={firstTurn}
        selfSessionId="alice-session"
      />,
    );
    act(() => {
      fixture.emit(LIVE_DRAWING_GUESSING_MESSAGE_TYPES.drawerBriefing, {
        word: "penguin",
        category: "Animal",
        turnNumber: 1,
        roundNumber: 1,
        letterCount: 7,
      });
    });
    expect(screen.getByTestId("ldg-drawer-word")).toHaveTextContent("penguin");
    const requestsBefore = fixture.sent.filter(
      (message) => message.type === LIVE_DRAWING_GUESSING_MESSAGE_TYPES.drawerRequest,
    ).length;

    const laterTurn = makeLiveDrawingGuessingState("preparing", {
      drawerPlayerId: "alice",
      turnNumber: 3,
      roundNumber: 2,
    });
    rerender(
      <LiveDrawingGuessingGameView
        connection={fixture.connection}
        state={laterTurn}
        selfSessionId="alice-session"
      />,
    );

    expect(screen.getByTestId("ldg-drawer-word")).toHaveTextContent("…");
    expect(
      fixture.sent.filter(
        (message) => message.type === LIVE_DRAWING_GUESSING_MESSAGE_TYPES.drawerRequest,
      ),
    ).toHaveLength(requestsBefore + 1);
  });

  it("shows the guesser the category, pattern, and drawer name during drawing", () => {
    const state = makeLiveDrawingGuessingState("drawing");
    renderGame(state, "bob-session");
    expect(screen.getByTestId("ldg-drawer-name")).toHaveTextContent("Alice is drawing");
    expect(screen.getByText("Category: Animal")).toBeInTheDocument();
    expect(screen.getByTestId("ldg-letter-pattern")).toHaveTextContent("_ _ _ _ _ _ _");
    expect(screen.getByLabelText("Your guess")).toBeInTheDocument();
  });

  it("submits a guess intent and shows private incorrect feedback", () => {
    const state = makeLiveDrawingGuessingState("drawing");
    const { sent, emit } = renderGame(state, "bob-session");
    fireEvent.change(screen.getByLabelText("Your guess"), {
      target: { value: "pinguin" },
    });
    fireEvent.click(screen.getByTestId("ldg-guess-submit"));
    expect(sent).toContainEqual({
      type: LIVE_DRAWING_GUESSING_MESSAGE_TYPES.guess,
      payload: { type: "guess", text: "pinguin" },
    });
    expect(screen.getByLabelText("Your guess")).toHaveValue("");
    expect(screen.getByLabelText("Your guess")).toHaveFocus();
    act(() => {
      emit(LIVE_DRAWING_GUESSING_MESSAGE_TYPES.guessFeedback, { kind: "incorrect" });
    });
    expect(screen.getByTestId("ldg-guess-feedback")).toHaveTextContent("Incorrect");
  });

  it("draws strokes from pointer input and sends them live to the server", () => {
    const state = makeLiveDrawingGuessingState("drawing");
    const { sent } = renderGame(state);
    const canvas = screen.getByTestId("ldg-canvas").querySelector("canvas");
    if (!canvas) {
      throw new Error("canvas missing");
    }
    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: "touch", clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: "touch", clientX: 60, clientY: 70 });
    fireEvent.pointerMove(canvas, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 110,
      clientY: 130,
    });
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: "touch", clientX: 160, clientY: 200 });
    const strokeMessages = sent.filter(
      (message) => message.type === LIVE_DRAWING_GUESSING_MESSAGE_TYPES.stroke,
    );
    expect(strokeMessages.length).toBeGreaterThanOrEqual(2);
    const first = strokeMessages[0]?.payload as {
      strokeId: string;
      color: string;
      points: number[];
      complete: boolean;
    };
    expect(first.color).toBe("#000000");
    expect(first.points.length).toBeGreaterThanOrEqual(2);
    const last = strokeMessages[strokeMessages.length - 1]?.payload as {
      complete: boolean;
    };
    expect(last.complete).toBe(true);
  });

  it("ignores a second finger while a stroke is in progress", () => {
    const state = makeLiveDrawingGuessingState("drawing");
    const { sent } = renderGame(state);
    const canvas = screen.getByTestId("ldg-canvas").querySelector("canvas");
    if (!canvas) {
      throw new Error("canvas missing");
    }
    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: "touch", clientX: 10, clientY: 10 });
    fireEvent.pointerDown(canvas, {
      pointerId: 2,
      pointerType: "touch",
      clientX: 200,
      clientY: 200,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 2,
      pointerType: "touch",
      clientX: 300,
      clientY: 300,
    });
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: "touch", clientX: 20, clientY: 20 });
    const strokeMessages = sent.filter(
      (message) => message.type === LIVE_DRAWING_GUESSING_MESSAGE_TYPES.stroke,
    );
    expect(strokeMessages).toHaveLength(1);
    const points = strokeMessages.flatMap((message) => {
      const payload = message.payload as { points: number[] };
      return payload.points;
    });
    expect(points).not.toContain(300);
  });

  it("sends undo for the most recent completed stroke", () => {
    const state = makeLiveDrawingGuessingState("drawing");
    const { sent } = renderGame(state);
    fireEvent.click(screen.getByTestId("ldg-undo"));
    expect(sent).toContainEqual({
      type: LIVE_DRAWING_GUESSING_MESSAGE_TYPES.undo,
      payload: { type: "undo" },
    });
  });

  it("disables undo when no completed strokes remain", () => {
    const emptyState = makeLiveDrawingGuessingState("drawing");
    emptyState.strokes.clear();
    renderGame(emptyState);
    expect(screen.getByTestId("ldg-undo")).toBeDisabled();
  });

  it("keeps spectators from guessing", () => {
    const state = makeLiveDrawingGuessingState("drawing", { bobSpectator: true });
    renderGame(state, "bob-session");
    expect(screen.getByRole("heading", { name: "Spectating" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Your guess")).not.toBeInTheDocument();
    expect(screen.getByTestId("ldg-canvas")).toHaveAttribute("data-interactive", "false");
  });

  it("disables drawing and guessing while the room transport is reconnecting", () => {
    const drawerState = makeLiveDrawingGuessingState("drawing");
    const drawerFixture = makeRoomConnection(drawerState, "alice-session");
    Object.assign(drawerFixture.connection, { reconnecting: true });
    const { unmount } = render(
      <LiveDrawingGuessingGameView
        connection={drawerFixture.connection}
        state={drawerState}
        selfSessionId="alice-session"
      />,
    );
    expect(screen.getByTestId("ldg-canvas")).toHaveAttribute("data-interactive", "false");
    expect(screen.getByText("Reconnecting…")).toBeInTheDocument();
    unmount();

    const guesserState = makeLiveDrawingGuessingState("drawing");
    const guesserFixture = makeRoomConnection(guesserState, "bob-session");
    Object.assign(guesserFixture.connection, { reconnecting: true });
    render(
      <LiveDrawingGuessingGameView
        connection={guesserFixture.connection}
        state={guesserState}
        selfSessionId="bob-session"
      />,
    );
    expect(screen.queryByLabelText("Your guess")).not.toBeInTheDocument();
    expect(screen.getByText("Reconnecting…")).toBeInTheDocument();
  });

  it("cancels an in-progress local stroke so drawing recovers after reconnect", () => {
    const state = makeLiveDrawingGuessingState("drawing");
    const fixture = makeRoomConnection(state, "alice-session");
    const { rerender } = render(
      <LiveDrawingGuessingGameView
        connection={fixture.connection}
        state={state}
        selfSessionId="alice-session"
      />,
    );
    const initialCanvas = screen.getByTestId("ldg-canvas").querySelector("canvas");
    if (!initialCanvas) {
      throw new Error("canvas missing");
    }
    fireEvent.pointerDown(initialCanvas, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 10,
      clientY: 10,
    });

    Object.assign(fixture.connection, { reconnecting: true });
    rerender(
      <LiveDrawingGuessingGameView
        connection={fixture.connection}
        state={state}
        selfSessionId="alice-session"
      />,
    );
    Object.assign(fixture.connection, { reconnecting: false });
    rerender(
      <LiveDrawingGuessingGameView
        connection={fixture.connection}
        state={state}
        selfSessionId="alice-session"
      />,
    );

    const recoveredCanvas = screen.getByTestId("ldg-canvas").querySelector("canvas");
    if (!recoveredCanvas) {
      throw new Error("canvas missing after reconnect");
    }
    fireEvent.pointerDown(recoveredCanvas, {
      pointerId: 2,
      pointerType: "touch",
      clientX: 20,
      clientY: 20,
    });
    fireEvent.pointerUp(recoveredCanvas, {
      pointerId: 2,
      pointerType: "touch",
      clientX: 40,
      clientY: 40,
    });

    expect(
      fixture.sent.some(
        (message) =>
          message.type === LIVE_DRAWING_GUESSING_MESSAGE_TYPES.stroke &&
          (message.payload as { complete?: boolean }).complete === true,
      ),
    ).toBe(true);
  });

  it("shows the solved result with the answer and winner", () => {
    const state = makeLiveDrawingGuessingState("result", { result: "solved" });
    renderGame(state, "bob-session");
    expect(screen.getByTestId("ldg-result-word")).toHaveTextContent("PENGUIN");
    expect(screen.getByTestId("ldg-result-winner")).toHaveTextContent("Bob +1");
    expect(screen.getByText("Alice +1")).toBeInTheDocument();
  });

  it("shows the round summary with current scores", () => {
    const state = makeLiveDrawingGuessingState("round-summary", {
      aliceScore: 2,
      bobScore: 1,
    });
    renderGame(state);
    expect(screen.getByText("Round 1 complete")).toBeInTheDocument();
    expect(screen.getByText("2 points")).toBeInTheDocument();
    expect(screen.getByText("1 point")).toBeInTheDocument();
  });

  it("renders the final leaderboard and lets the host play again", () => {
    const state = makeLiveDrawingGuessingState("finished");
    const { sent } = renderGame(state);
    expect(screen.getByText("Alice wins!")).toBeInTheDocument();
    expect(screen.getByTestId("ldg-leaderboard")).toHaveTextContent("#1");
    fireEvent.click(screen.getByTestId("ldg-play-again"));
    expect(sent).toContainEqual({ type: "play_again", payload: {} });
  });

  it("builds a tied finished state with shared rank", () => {
    const state = makeLiveDrawingGuessingState("finished", { tie: true });
    renderGame(state);
    expect(screen.getByText("Joint winners")).toBeInTheDocument();
    expect(screen.getAllByText("#1")).toHaveLength(2);
  });

  it("stays usable at 320px without page-level horizontal scrolling", () => {
    const state = makeLiveDrawingGuessingState("drawing");
    renderGame(state);
    const main = screen.getByRole("main");
    expect(main).toHaveStyle({ overflow: "hidden", width: "100%" });
  });
});
