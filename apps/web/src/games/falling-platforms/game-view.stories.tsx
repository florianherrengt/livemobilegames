import { Box } from "@mui/material";
import type { Meta, StoryObj } from "@storybook/react-vite";

import type { RoomConnection } from "../../game-connection.js";
import { makeFallingPlatformsState, makeRoomConnection } from "./fixtures.js";
import { FallingPlatformsGameView } from "./game-view.js";

function makeArgs(
  phase: "lobby" | "countdown" | "playing" | "results",
  options: {
    roundNumber?: number;
    draw?: boolean;
    aliceAlive?: boolean;
  } = {},
) {
  const state = makeFallingPlatformsState(phase, {
    roundNumber: options.roundNumber ?? (phase === "lobby" ? 0 : 1),
    draw: options.draw ?? false,
    aliceAlive: options.aliceAlive ?? true,
    winnerSessionId: options.draw === true ? "" : "host-session",
  });
  const { connection } = makeRoomConnection(state);
  return {
    connection,
    state,
    selfSessionId: "host-session",
  };
}

function NarrowPhoneStory() {
  const args = makeArgs("playing");
  return (
    <Box sx={{ width: 320, height: "100dvh", overflow: "hidden" }}>
      <FallingPlatformsGameView
        connection={args.connection}
        state={args.state}
        selfSessionId={args.selfSessionId}
      />
    </Box>
  );
}

const meta = {
  title: "Games/Falling Platforms",
  component: FallingPlatformsGameView,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof FallingPlatformsGameView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Lobby: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeFallingPlatformsState>;
    selfSessionId: string;
  }) => <FallingPlatformsGameView {...args} />,
  args: makeArgs("lobby"),
};

export const LobbyAfterMatch: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeFallingPlatformsState>;
    selfSessionId: string;
  }) => <FallingPlatformsGameView {...args} />,
  args: makeArgs("lobby", { roundNumber: 1 }),
};

export const Countdown: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeFallingPlatformsState>;
    selfSessionId: string;
  }) => <FallingPlatformsGameView {...args} />,
  args: makeArgs("countdown"),
};

export const Playing: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeFallingPlatformsState>;
    selfSessionId: string;
  }) => <FallingPlatformsGameView {...args} />,
  args: makeArgs("playing"),
};

export const Spectating: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeFallingPlatformsState>;
    selfSessionId: string;
  }) => <FallingPlatformsGameView {...args} />,
  args: makeArgs("playing", { aliceAlive: false }),
};

export const Results: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeFallingPlatformsState>;
    selfSessionId: string;
  }) => <FallingPlatformsGameView {...args} />,
  args: makeArgs("results"),
};

export const DrawResults: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeFallingPlatformsState>;
    selfSessionId: string;
  }) => <FallingPlatformsGameView {...args} />,
  args: makeArgs("results", { draw: true }),
};

export const NarrowPhone: Story = {
  render: () => <NarrowPhoneStory />,
  args: makeArgs("playing"),
};
