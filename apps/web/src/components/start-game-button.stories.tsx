import { LobbyPlayerState, LobbyRoomState } from "@phone-party/protocol";
import type { Meta, StoryObj } from "@storybook/react-vite";

import type { RoomConnection } from "../game-connection.js";
import { StartGameButton } from "./start-game-button.js";

function lobbyState(gameId: string, playerCount: number): LobbyRoomState {
  const state = new LobbyRoomState();
  state.roomCode = "ABC234";
  state.gameId = gameId;
  state.hostSessionId = "host-session";
  for (let index = 0; index < playerCount; index++) {
    const player = new LobbyPlayerState();
    player.playerId = `player-${index}`;
    player.name = `Player ${index + 1}`;
    state.players.set(`session-${index}`, player);
  }
  return state;
}

const connection = {
  room: { send: () => undefined, onMessage: () => () => undefined },
} as unknown as RoomConnection;

const meta = {
  title: "Room/Start game",
  component: StartGameButton,
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof StartGameButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {
  args: {
    connection,
    state: lobbyState("capital-pin", 2),
    selfSessionId: "host-session",
  },
};

export const WaitingForPlayers: Story = {
  args: {
    connection,
    state: lobbyState("capital-pin", 1),
    selfSessionId: "host-session",
  },
};

export const NoGameSelected: Story = {
  args: {
    connection,
    state: lobbyState("", 2),
    selfSessionId: "host-session",
  },
};

export const NonHost: Story = {
  args: {
    connection,
    state: lobbyState("capital-pin", 2),
    selfSessionId: "guest-session",
  },
};
