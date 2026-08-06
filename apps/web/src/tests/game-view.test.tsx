import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeCapitalPinState,
  makeMatchResult,
  makeRoomConnection,
  makeRoundResult,
} from "../games/capital-pin/fixtures.js";
import { CapitalPinGameView } from "../games/capital-pin/game-view.js";
import { maplibreMock } from "./setup.js";

const sounds = vi.hoisted(() => ({
  initialise: vi.fn().mockResolvedValue(undefined),
  pinDrop: vi.fn(),
  pinMove: vi.fn(),
  guessConfirmed: vi.fn(),
  answerReveal: vi.fn(),
  connectionWhoosh: vi.fn(),
  roundWin: vi.fn(),
  scoreResult: vi.fn(),
}));

const feedback = vi.hoisted(() => ({
  gameFeedback: vi.fn(),
  hapticFeedback: vi.fn(),
  primeGameFeedback: vi.fn(),
}));

vi.mock("../games/capital-pin/audio/GeoPinSounds.js", () => ({
  geoPinSounds: sounds,
}));
vi.mock("../feedback.js", () => feedback);

describe("CapitalPinGameView", () => {
  beforeEach(() => {
    maplibreMock.instances.length = 0;
    vi.clearAllMocks();
  });

  it("shows the waiting state while the roster is arriving", () => {
    const state = makeCapitalPinState("lobby");
    const { connection } = makeRoomConnection(state);
    render(
      <CapitalPinGameView connection={connection} state={state} selfSessionId="host-session" />,
    );
    expect(screen.getByText("Players (2)")).toBeInTheDocument();
    expect(
      screen.getByText("Waiting for everyone to join, then the first round starts automatically."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start game" })).not.toBeInTheDocument();
  });

  it("drops a pin on the map and locks a submit intent", async () => {
    const state = makeCapitalPinState("round");
    const { connection, sent } = makeRoomConnection(state);
    render(
      <CapitalPinGameView connection={connection} state={state} selfSessionId="host-session" />,
    );
    expect(screen.getByText("Paris")).toBeInTheDocument();

    const map = maplibreMock.instances.at(-1);
    expect(map).toBeDefined();
    act(() => {
      map?.emit("click", { lngLat: { lng: 2.35, lat: 48.85 } });
    });
    const lock = screen.getByRole("button", { name: "Lock answer" });
    expect(lock).toBeEnabled();
    lock.click();
    expect(sent).toContainEqual({
      type: "game:submit",
      payload: { type: "submit", roundNumber: 1, latitude: 48.85, longitude: 2.35 },
    });
    expect(feedback.hapticFeedback).toHaveBeenCalledWith("select");
    expect(feedback.hapticFeedback).toHaveBeenCalledWith("confirm");
  });

  it("shows the how-to briefly on round one and hides it on later rounds", async () => {
    const state = makeCapitalPinState("round", { roundNumber: 1 });
    const { connection } = makeRoomConnection(state);
    const { rerender } = render(
      <CapitalPinGameView connection={connection} state={state} selfSessionId="host-session" />,
    );
    expect(screen.getByText("How to play Capital Pin")).toBeInTheDocument();
    rerender(
      <CapitalPinGameView
        connection={connection}
        state={makeCapitalPinState("round", { roundNumber: 2 })}
        selfSessionId="host-session"
      />,
    );
    await act(async () => {});
    expect(screen.queryByText("How to play Capital Pin")).not.toBeInTheDocument();
  });

  it("locks the answer button once the server marks the player as submitted", async () => {
    const state = makeCapitalPinState("round", { submitted: true });
    const { connection } = makeRoomConnection(state);
    render(
      <CapitalPinGameView connection={connection} state={state} selfSessionId="host-session" />,
    );
    expect(screen.getByRole("button", { name: "Answer locked" })).toBeDisabled();
  });

  it("renders the results map and standings after a round", async () => {
    const state = makeCapitalPinState("round-results", {
      lastResult: makeRoundResult(),
    });
    const { connection } = makeRoomConnection(state);
    render(
      <CapitalPinGameView connection={connection} state={state} selfSessionId="host-session" />,
    );
    expect(await screen.findByText("Round 1: Paris")).toBeInTheDocument();
    expect(screen.getByText("0.7 km")).toBeInTheDocument();
    expect(screen.getByText("1,054 km")).toBeInTheDocument();
    expect(screen.getByText("winner")).toBeInTheDocument();
  });

  it("renders the final leaderboard and lets the host play again", () => {
    const state = makeCapitalPinState("finished", { result: makeMatchResult() });
    const { connection, sent } = makeRoomConnection(state);
    render(
      <CapitalPinGameView connection={connection} state={state} selfSessionId="host-session" />,
    );
    expect(screen.getByText("#1")).toBeInTheDocument();
    expect(screen.getByText("7 wins")).toBeInTheDocument();
    screen.getByRole("button", { name: "Play again" }).click();
    expect(sent).toContainEqual({ type: "play_again", payload: {} });
  });
});
