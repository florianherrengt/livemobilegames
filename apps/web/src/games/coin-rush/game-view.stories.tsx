import { Box } from "@mui/material";
import type { Meta, StoryObj } from "@storybook/react-vite";

import type { RoomConnection } from "../../game-connection.js";
import { makeCoinRushResult, makeCoinRushState, makeRoomConnection } from "./fixtures.js";
import { CoinRushGameView } from "./game-view.js";

function makeArgs(
  phase: "lobby" | "countdown" | "playing" | "round-result" | "finished",
  options: {
    aliceAlive?: boolean;
    bobAlive?: boolean;
    aliceRespawning?: boolean;
    aliceScore?: number;
    bobScore?: number;
    aliceRoundWins?: number;
    bobRoundWins?: number;
    suddenDeath?: boolean;
    result?: ReturnType<typeof makeCoinRushResult> | null;
  } = {},
) {
  const state = makeCoinRushState(phase, {
    ...(options.aliceAlive !== undefined ? { aliceAlive: options.aliceAlive } : {}),
    ...(options.bobAlive !== undefined ? { bobAlive: options.bobAlive } : {}),
    ...(options.aliceRespawning !== undefined ? { aliceRespawning: options.aliceRespawning } : {}),
    ...(options.aliceScore !== undefined ? { aliceScore: options.aliceScore } : {}),
    ...(options.bobScore !== undefined ? { bobScore: options.bobScore } : {}),
    ...(options.aliceRoundWins !== undefined ? { aliceRoundWins: options.aliceRoundWins } : {}),
    ...(options.bobRoundWins !== undefined ? { bobRoundWins: options.bobRoundWins } : {}),
    ...(options.suddenDeath !== undefined ? { suddenDeath: options.suddenDeath } : {}),
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
  const args = makeArgs("playing");
  return (
    <Box sx={{ width: 320, height: "100dvh", overflow: "hidden" }}>
      <CoinRushGameView
        connection={args.connection}
        state={args.state}
        selfSessionId={args.selfSessionId}
      />
    </Box>
  );
}

const meta = {
  title: "Games/Coin Rush",
  component: CoinRushGameView,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof CoinRushGameView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Lobby: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeCoinRushState>;
    selfSessionId: string;
  }) => <CoinRushGameView {...args} />,
  args: makeArgs("lobby"),
};

export const Countdown: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeCoinRushState>;
    selfSessionId: string;
  }) => <CoinRushGameView {...args} />,
  args: makeArgs("countdown"),
};

export const Playing: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeCoinRushState>;
    selfSessionId: string;
  }) => <CoinRushGameView {...args} />,
  args: makeArgs("playing"),
};

export const Respawning: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeCoinRushState>;
    selfSessionId: string;
  }) => <CoinRushGameView {...args} />,
  args: makeArgs("playing", { aliceAlive: false, aliceRespawning: true }),
};

export const SuddenDeath: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeCoinRushState>;
    selfSessionId: string;
  }) => <CoinRushGameView {...args} />,
  args: makeArgs("playing", { aliceScore: 10, bobScore: 10, suddenDeath: true }),
};

export const RoundResult: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeCoinRushState>;
    selfSessionId: string;
  }) => <CoinRushGameView {...args} />,
  args: makeArgs("round-result", {
    aliceScore: 12,
    bobScore: 7,
    aliceRoundWins: 1,
    bobRoundWins: 0,
  }),
};

export const Finished: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeCoinRushState>;
    selfSessionId: string;
  }) => <CoinRushGameView {...args} />,
  args: makeArgs("finished", {
    result: makeCoinRushResult(),
    aliceRoundWins: 2,
    bobRoundWins: 1,
  }),
};

export const TiedFinished: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeCoinRushState>;
    selfSessionId: string;
  }) => <CoinRushGameView {...args} />,
  args: makeArgs("finished", {
    result: makeCoinRushResult({ tie: true }),
    aliceRoundWins: 2,
    bobRoundWins: 2,
  }),
};

export const NarrowPhone: Story = {
  render: () => <NarrowPhoneStory />,
  args: makeArgs("playing"),
};
