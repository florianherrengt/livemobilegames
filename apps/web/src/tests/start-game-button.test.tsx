import { LobbyPlayerState, LobbyRoomState } from "@phone-party/protocol";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { StartGameButton } from "../components/start-game-button.js";
import type { RoomConnection } from "../game-connection.js";

function makeLobby(gameId: string, players: number, hostSessionId: string): LobbyRoomState {
  const state = new LobbyRoomState();
  state.gameId = gameId;
  state.hostSessionId = hostSessionId;
  for (let index = 0; index < players; index++) {
    const player = new LobbyPlayerState();
    player.name = `Player ${index}`;
    state.players.set(`session-${index}`, player);
  }
  return state;
}

function makeConnection() {
  let errorListener: ((payload: unknown) => void) | undefined;
  const room = {
    send: vi.fn(),
    onMessage: vi.fn((_type: string, callback: (payload: unknown) => void) => {
      errorListener = callback;
      return () => {
        errorListener = undefined;
      };
    }),
  };
  const connection = { room } as unknown as RoomConnection;
  return { connection, room, getErrorListener: () => errorListener };
}

describe("StartGameButton", () => {
  it("enables only the host with a game and enough players", () => {
    const { connection } = makeConnection();
    const { rerender } = render(
      <StartGameButton
        connection={connection}
        state={makeLobby("capital-pin", 2, "host")}
        selfSessionId="host"
      />,
    );
    expect(screen.getByRole("button", { name: "Start game" })).toBeEnabled();

    rerender(
      <StartGameButton
        connection={connection}
        state={makeLobby("capital-pin", 2, "host")}
        selfSessionId="other"
      />,
    );
    expect(screen.getByRole("button", { name: "Waiting for the host…" })).toBeDisabled();

    rerender(
      <StartGameButton
        connection={connection}
        state={makeLobby("", 2, "host")}
        selfSessionId="host"
      />,
    );
    expect(screen.getByRole("button", { name: "Choose a game first" })).toBeDisabled();
  });

  it("shows a typed room error returned by the lobby", () => {
    const { connection, getErrorListener } = makeConnection();
    render(
      <StartGameButton
        connection={connection}
        state={makeLobby("capital-pin", 1, "host")}
        selfSessionId="host"
      />,
    );
    act(() => {
      getErrorListener()?.({
        code: "NOT_ENOUGH_PLAYERS",
        message: "At least 2 players are required",
      });
    });
    expect(screen.getByText("At least 2 players are required")).toBeInTheDocument();
  });
});
