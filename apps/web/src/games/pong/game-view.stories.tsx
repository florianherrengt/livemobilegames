import { Box } from "@mui/material";
import type { Meta, StoryObj } from "@storybook/react-vite";

import type { RoomConnection } from "../../game-connection.js";
import { makePongResult, makePongState, makeRoomConnection } from "./fixtures.js";
import { PongGameView } from "./game-view.js";

function makeArgs(
  phase: "lobby" | "countdown" | "running" | "finished",
  options: {
    aliceReconnecting?: boolean;
    aliceScore?: number;
    bobScore?: number;
    playerCount?: 2 | 4;
    ballCount?: number;
    result?: ReturnType<typeof makePongResult> | null;
  } = {},
) {
  const state = makePongState(phase, {
    ...(options.aliceReconnecting !== undefined
      ? { aliceReconnecting: options.aliceReconnecting }
      : {}),
    ...(options.aliceScore !== undefined ? { aliceScore: options.aliceScore } : {}),
    ...(options.bobScore !== undefined ? { bobScore: options.bobScore } : {}),
    ...(options.playerCount !== undefined ? { playerCount: options.playerCount } : {}),
    ...(options.ballCount !== undefined ? { ballCount: options.ballCount } : {}),
    ...(options.result !== undefined ? { result: options.result } : {}),
  });
  const { connection } = makeRoomConnection(state);
  return {
    connection,
    state,
    selfSessionId: "host-session",
  };
}

function NarrowPhoneStory() {
  const args = makeArgs("running");
  return (
    <Box sx={{ width: 320, height: "100dvh", overflow: "hidden" }}>
      <PongGameView
        connection={args.connection}
        state={args.state}
        selfSessionId={args.selfSessionId}
      />
    </Box>
  );
}

const meta = {
  title: "Games/Four-Sided Pong",
  component: PongGameView,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof PongGameView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Lobby: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makePongState>;
    selfSessionId: string;
  }) => <PongGameView {...args} />,
  args: makeArgs("lobby"),
};

export const Countdown: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makePongState>;
    selfSessionId: string;
  }) => <PongGameView {...args} />,
  args: makeArgs("countdown"),
};

export const Running: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makePongState>;
    selfSessionId: string;
  }) => <PongGameView {...args} />,
  args: makeArgs("running"),
};

export const FourPlayers: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makePongState>;
    selfSessionId: string;
  }) => <PongGameView {...args} />,
  args: makeArgs("running", { playerCount: 4, ballCount: 3 }),
};

export const Reconnecting: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makePongState>;
    selfSessionId: string;
  }) => <PongGameView {...args} />,
  args: makeArgs("running", { aliceReconnecting: true }),
};

export const Finished: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makePongState>;
    selfSessionId: string;
  }) => <PongGameView {...args} />,
  args: makeArgs("finished", {
    result: makePongResult(),
    aliceScore: 10,
    bobScore: 7,
  }),
};

export const TiedFinished: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makePongState>;
    selfSessionId: string;
  }) => <PongGameView {...args} />,
  args: makeArgs("finished", {
    result: makePongResult({ tie: true }),
    aliceScore: 10,
    bobScore: 10,
  }),
};

export const NarrowPhone: Story = {
  render: () => <NarrowPhoneStory />,
  args: makeArgs("running"),
};
