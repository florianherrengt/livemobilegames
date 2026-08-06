import { Box } from "@mui/material";
import type { Meta, StoryObj } from "@storybook/react-vite";

import type { RoomConnection } from "../../game-connection.js";
import { makeFlappyRaceResult, makeFlappyRaceState, makeRoomConnection } from "./fixtures.js";
import { FlappyRaceGameView } from "./game-view.js";

function makeArgs(
  phase: "lobby" | "countdown" | "running" | "round-result" | "finished",
  options: {
    aliceActive?: boolean;
    bobActive?: boolean;
    aliceReconnecting?: boolean;
    aliceRoundWins?: number;
    bobRoundWins?: number;
    result?: ReturnType<typeof makeFlappyRaceResult> | null;
  } = {},
) {
  const state = makeFlappyRaceState(phase, {
    aliceActive: options.aliceActive,
    bobActive: options.bobActive,
    aliceReconnecting: options.aliceReconnecting,
    aliceRoundWins: options.aliceRoundWins,
    bobRoundWins: options.bobRoundWins,
    result: options.result,
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
      <FlappyRaceGameView
        connection={args.connection}
        state={args.state}
        selfSessionId={args.selfSessionId}
      />
    </Box>
  );
}

const meta = {
  title: "Games/Flappy Race",
  component: FlappyRaceGameView,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof FlappyRaceGameView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Lobby: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeFlappyRaceState>;
    selfSessionId: string;
  }) => <FlappyRaceGameView {...args} />,
  args: makeArgs("lobby"),
};

export const Countdown: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeFlappyRaceState>;
    selfSessionId: string;
  }) => <FlappyRaceGameView {...args} />,
  args: makeArgs("countdown"),
};

export const Running: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeFlappyRaceState>;
    selfSessionId: string;
  }) => <FlappyRaceGameView {...args} />,
  args: makeArgs("running"),
};

export const Spectating: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeFlappyRaceState>;
    selfSessionId: string;
  }) => <FlappyRaceGameView {...args} />,
  args: makeArgs("running", { aliceActive: false, bobActive: true }),
};

export const Reconnecting: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeFlappyRaceState>;
    selfSessionId: string;
  }) => <FlappyRaceGameView {...args} />,
  args: makeArgs("running", { aliceReconnecting: true }),
};

export const RoundResult: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeFlappyRaceState>;
    selfSessionId: string;
  }) => <FlappyRaceGameView {...args} />,
  args: makeArgs("round-result", {
    aliceActive: false,
    bobActive: false,
    aliceRoundWins: 2,
    bobRoundWins: 1,
  }),
};

export const Finished: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeFlappyRaceState>;
    selfSessionId: string;
  }) => <FlappyRaceGameView {...args} />,
  args: makeArgs("finished", {
    result: makeFlappyRaceResult(),
    aliceRoundWins: 5,
    bobRoundWins: 4,
  }),
};

export const TiedFinished: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeFlappyRaceState>;
    selfSessionId: string;
  }) => <FlappyRaceGameView {...args} />,
  args: makeArgs("finished", {
    result: makeFlappyRaceResult({ tie: true }),
    aliceRoundWins: 5,
    bobRoundWins: 5,
  }),
};

export const NarrowPhone: Story = {
  render: () => <NarrowPhoneStory />,
  args: makeArgs("running"),
};
