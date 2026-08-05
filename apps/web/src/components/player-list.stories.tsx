import { LobbyPlayerState } from "@phone-party/protocol";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { PlayerList } from "./player-list.js";

function player(playerId: string, name: string, isHost = false): LobbyPlayerState {
  const value = new LobbyPlayerState();
  value.playerId = playerId;
  value.name = name;
  value.isHost = isHost;
  return value;
}

const players = new Map([
  ["session-alice", player("player-alice", "Alice", true)],
  ["session-bob", player("player-bob", "Bob")],
  ["session-carol", player("player-carol", "Carol with a deliberately long display name")],
]);

const meta = {
  title: "Room/Player list",
  component: PlayerList,
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof PlayerList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ThreePlayers: Story = {
  args: {
    players,
    selfSessionId: "session-alice",
  },
};

export const Empty: Story = {
  args: {
    players: new Map(),
    selfSessionId: "",
  },
};
