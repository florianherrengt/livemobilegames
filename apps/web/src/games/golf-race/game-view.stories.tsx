import { Box } from "@mui/material";
import type { Meta, StoryObj } from "@storybook/react-vite";

import type { RoomConnection } from "../../game-connection.js";
import { makeGolfRaceResult, makeGolfRaceState, makeRoomConnection } from "./fixtures.js";
import { GolfRaceGameView } from "./game-view.js";

function makeArgs(
  phase: "lobby" | "countdown" | "aiming" | "simulating" | "round-result" | "finished",
  options: {
    aliceFinished?: boolean | undefined;
    bobFinished?: boolean | undefined;
    aliceImmune?: boolean | undefined;
    aliceRoundWins?: number | undefined;
    aliceMatchPoints?: number | undefined;
    bobMatchPoints?: number | undefined;
    result?: ReturnType<typeof makeGolfRaceResult> | null;
  } = {},
) {
  const state = makeGolfRaceState(phase, {
    aliceFinished: options.aliceFinished,
    bobFinished: options.bobFinished,
    aliceImmune: options.aliceImmune,
    aliceRoundWins: options.aliceRoundWins,
    aliceMatchPoints: options.aliceMatchPoints,
    bobMatchPoints: options.bobMatchPoints,
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
  const args = makeArgs("aiming");
  return (
    <Box sx={{ width: 320, height: "100dvh", overflow: "hidden" }}>
      <GolfRaceGameView
        connection={args.connection}
        state={args.state}
        selfSessionId={args.selfSessionId}
      />
    </Box>
  );
}

const meta = {
  title: "Games/Golf Race",
  component: GolfRaceGameView,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof GolfRaceGameView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Lobby: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeGolfRaceState>;
    selfSessionId: string;
  }) => <GolfRaceGameView {...args} />,
  args: makeArgs("lobby"),
};

export const Countdown: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeGolfRaceState>;
    selfSessionId: string;
  }) => <GolfRaceGameView {...args} />,
  args: makeArgs("countdown"),
};

export const Aiming: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeGolfRaceState>;
    selfSessionId: string;
  }) => <GolfRaceGameView {...args} />,
  args: makeArgs("aiming"),
};

export const Spectating: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeGolfRaceState>;
    selfSessionId: string;
  }) => <GolfRaceGameView {...args} />,
  args: {
    ...makeArgs("aiming", { bobFinished: false }),
    selfSessionId: "bob-session",
  },
};

export const Simulating: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeGolfRaceState>;
    selfSessionId: string;
  }) => <GolfRaceGameView {...args} />,
  args: makeArgs("simulating"),
};

export const RoundResult: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeGolfRaceState>;
    selfSessionId: string;
  }) => <GolfRaceGameView {...args} />,
  args: makeArgs("round-result", {
    aliceRoundWins: 1,
    aliceMatchPoints: 7,
    bobMatchPoints: 3,
  }),
};

export const ImmuneRespawn: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeGolfRaceState>;
    selfSessionId: string;
  }) => <GolfRaceGameView {...args} />,
  args: makeArgs("simulating", { aliceImmune: true }),
};

export const Finished: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeGolfRaceState>;
    selfSessionId: string;
  }) => <GolfRaceGameView {...args} />,
  args: makeArgs("finished", {
    result: makeGolfRaceResult(),
    aliceFinished: true,
    bobFinished: true,
  }),
};

export const NarrowPhone: Story = {
  render: () => <NarrowPhoneStory />,
  args: makeArgs("aiming"),
};
