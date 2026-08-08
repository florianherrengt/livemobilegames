import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArenaView } from "../games/kart-racing/arena-view.js";
import { cameraRotation, cameraScale, smoothCamera } from "../games/kart-racing/camera.js";
import {
  makeKartRacingResult,
  makeKartRacingState,
  makeRoomConnection,
} from "../games/kart-racing/fixtures.js";
import { KartRacingGameView } from "../games/kart-racing/game-view.js";
import { steeringFromOffset, swipeOutcome } from "../games/kart-racing/gesture.js";

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
    rotate: vi.fn(),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    font: "",
    textAlign: "left",
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    quadraticCurveTo: vi.fn(),
    setLineDash: vi.fn(),
    strokeText: vi.fn(),
    fillText: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

describe("Kart Racing gesture recognition", () => {
  it("maps horizontal offsets to capped relative steering", () => {
    expect(steeringFromOffset(0)).toBe(0);
    expect(steeringFromOffset(40)).toBeCloseTo(0.5);
    expect(steeringFromOffset(80)).toBe(1);
    expect(steeringFromOffset(200)).toBe(1);
    expect(steeringFromOffset(-80)).toBe(-1);
  });

  it("fires only on fast, clearly vertical upward swipes", () => {
    expect(swipeOutcome(0, 70, 200)).toBe("shoot");
    expect(swipeOutcome(40, 70, 200)).toBe("none");
    expect(swipeOutcome(0, 40, 200)).toBe("none");
    expect(swipeOutcome(0, 70, 300)).toBe("none");
  });
});

describe("Kart Racing camera", () => {
  it("maps the kart heading to screen-up and fits phone viewports", () => {
    expect(cameraRotation(0)).toBeCloseTo(-Math.PI / 2);
    expect(cameraRotation(Math.PI / 2)).toBeCloseTo(-Math.PI);
    expect(cameraScale(390, 844)).toBeGreaterThan(0.45);
    expect(cameraScale(320, 568)).toBeGreaterThan(0.45);
  });

  it("smooths toward the target without snapping", () => {
    const start = { x: 0, y: 0, heading: 0 };
    const target = { x: 100, y: 100, heading: Math.PI };
    const next = smoothCamera(start, target, 0.1);
    expect(next.x).toBeGreaterThan(0);
    expect(next.x).toBeLessThan(100);
    expect(Math.abs(next.heading)).toBeGreaterThan(0);
    expect(Math.abs(next.heading)).toBeLessThan(Math.PI);
  });
});

describe("KartRacingGameView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.removeItem("kart-racing-e2e-driver");
    delete (window as unknown as { __kartRacingDrive?: unknown }).__kartRacingDrive;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(createMockContext());
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
  });

  afterEach(() => {
    window.sessionStorage.removeItem("kart-racing-e2e-driver");
    delete (window as unknown as { __kartRacingDrive?: unknown }).__kartRacingDrive;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows the waiting lobby before a match", () => {
    const state = makeKartRacingState("lobby");
    const { connection } = makeRoomConnection(state);
    render(
      <KartRacingGameView connection={connection} state={state} selfSessionId="host-session" />,
    );
    expect(screen.getByText("Players (2)")).toBeInTheDocument();
    expect(
      screen.getByText("Waiting for everyone to join, then the next match starts automatically."),
    ).toBeInTheDocument();
  });

  it("shows the countdown with how-to instructions on race one", () => {
    const state = makeKartRacingState("countdown");
    const { connection } = makeRoomConnection(state);
    render(
      <KartRacingGameView connection={connection} state={state} selfSessionId="host-session" />,
    );
    expect(screen.getByText("How to play Kart Racing")).toBeInTheDocument();
    expect(screen.getByText("Drag left and right to steer.")).toBeInTheDocument();
    expect(screen.getByText("Swipe up to shoot.")).toBeInTheDocument();
  });

  it("sends steering intents from pointer drags", () => {
    const state = makeKartRacingState("racing");
    const { connection, sent } = makeRoomConnection(state);
    const { container } = render(
      <ArenaView connection={connection} state={state} selfSessionId="host-session" />,
    );
    const arena = container.querySelector("[data-testid='kart-racing-arena']");
    if (!arena) {
      throw new Error("arena missing");
    }
    fireEvent.pointerDown(arena, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(arena, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 180,
      clientY: 100,
    });
    expect(sent).toContainEqual(
      expect.objectContaining({
        type: "game:steer",
        payload: expect.objectContaining({ type: "steer", steering: 1 }),
      }),
    );
    fireEvent.pointerUp(arena, { pointerId: 1, pointerType: "touch" });
    expect(sent).toContainEqual(
      expect.objectContaining({
        type: "game:steer",
        payload: expect.objectContaining({ type: "steer", steering: 0 }),
      }),
    );
  });

  it("only exposes the scripted driver after an explicit test-session opt in", () => {
    const state = makeKartRacingState("racing");
    const { connection } = makeRoomConnection(state);
    const first = render(
      <ArenaView connection={connection} state={state} selfSessionId="host-session" />,
    );
    expect(
      (window as unknown as { __kartRacingDrive?: unknown }).__kartRacingDrive,
    ).toBeUndefined();
    first.unmount();

    window.sessionStorage.setItem("kart-racing-e2e-driver", "1");
    render(<ArenaView connection={connection} state={state} selfSessionId="host-session" />);
    expect(
      (window as unknown as { __kartRacingDrive?: { steer: unknown; shoot: unknown } })
        .__kartRacingDrive,
    ).toEqual({ steer: expect.any(Function), shoot: expect.any(Function) });
  });

  it("sends a shoot intent on a deliberate upward swipe when loaded", () => {
    const state = makeKartRacingState("racing", { aliceAmmo: true });
    const { connection, sent } = makeRoomConnection(state);
    const { container } = render(
      <ArenaView connection={connection} state={state} selfSessionId="host-session" />,
    );
    const arena = container.querySelector("[data-testid='kart-racing-arena']");
    if (!arena) {
      throw new Error("arena missing");
    }
    fireEvent.pointerDown(arena, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(arena, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 100,
      clientY: 25,
    });
    expect(sent).toContainEqual(
      expect.objectContaining({
        type: "game:shoot",
        payload: expect.objectContaining({ type: "shoot", raceNumber: 1 }),
      }),
    );
    expect(feedback.gameFeedback).toHaveBeenCalledWith("move");
  });

  it("does not send a shoot intent and shows an empty-ammo response on an empty swipe", async () => {
    const state = makeKartRacingState("racing", { aliceAmmo: false });
    const { connection, sent } = makeRoomConnection(state);
    const { container } = render(
      <ArenaView connection={connection} state={state} selfSessionId="host-session" />,
    );
    const arena = container.querySelector("[data-testid='kart-racing-arena']");
    if (!arena) {
      throw new Error("arena missing");
    }
    fireEvent.pointerDown(arena, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(arena, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 100,
      clientY: 25,
    });
    expect(sent.some((message) => message.type === "game:shoot")).toBe(false);
    expect(await screen.findByText("No ammo — collect a crate.")).toBeInTheDocument();
  });

  it("lets the hold buttons and arrow keys steer", () => {
    const state = makeKartRacingState("racing");
    const { connection, sent } = makeRoomConnection(state);
    render(<ArenaView connection={connection} state={state} selfSessionId="host-session" />);
    fireEvent.pointerDown(screen.getByTestId("kart-steer-right"), { pointerType: "touch" });
    expect(sent).toContainEqual(
      expect.objectContaining({
        type: "game:steer",
        payload: expect.objectContaining({ steering: 1 }),
      }),
    );
    fireEvent.pointerUp(screen.getByTestId("kart-steer-right"), { pointerType: "touch" });
    fireEvent.keyDown(window, { code: "ArrowLeft" });
    expect(sent).toContainEqual(
      expect.objectContaining({
        type: "game:steer",
        payload: expect.objectContaining({ steering: -1 }),
      }),
    );
    fireEvent.keyUp(window, { code: "ArrowLeft" });
  });

  it("renders race results with points, totals, and the next-race countdown", () => {
    const state = makeKartRacingState("race-result");
    const { connection } = makeRoomConnection(state);
    render(
      <KartRacingGameView connection={connection} state={state} selfSessionId="host-session" />,
    );
    expect(screen.getByText("Race 1 result")).toBeInTheDocument();
    expect(screen.getByText("+8 pts")).toBeInTheDocument();
    expect(screen.getByText("8 total")).toBeInTheDocument();
    expect(screen.getByText(/Next race in/)).toBeInTheDocument();
  });

  it("renders the final leaderboard and lets the host play again", () => {
    const state = makeKartRacingState("finished", { result: makeKartRacingResult() });
    const { connection, sent } = makeRoomConnection(state);
    render(
      <KartRacingGameView connection={connection} state={state} selfSessionId="host-session" />,
    );
    expect(screen.getByText("Alice wins the match!")).toBeInTheDocument();
    expect(screen.getByText("24 pts")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Play again" }));
    expect(sent).toContainEqual({ type: "play_again", payload: {} });
  });

  it("keeps the arena overflow hidden for 320px layouts", () => {
    const state = makeKartRacingState("racing");
    const { connection } = makeRoomConnection(state);
    render(<ArenaView connection={connection} state={state} selfSessionId="host-session" />);
    expect(screen.getByTestId("kart-racing-arena")).toHaveStyle({
      overflow: "hidden",
      position: "relative",
    });
  });
});
