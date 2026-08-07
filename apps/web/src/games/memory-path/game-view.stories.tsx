import { Box } from "@mui/material";
import type { Meta, StoryObj } from "@storybook/react-vite";

import type { RoomConnection } from "../../game-connection.js";
import {
  makeMemoryPathMatchResult,
  makeMemoryPathRoundResult,
  makeMemoryPathState,
  makeRoomConnection,
} from "./fixtures.js";
import { MemoryPathGameView } from "./game-view.js";

function makeArgs(
  phase: "lobby" | "preparing" | "preview" | "racing" | "round-result" | "match-result",
  options: {
    pathVisible?: boolean;
    opponentsVisible?: boolean;
    aliceFalling?: boolean;
    aliceReconnecting?: boolean;
    suddenDeath?: boolean;
    aliceActive?: boolean;
    bobActive?: boolean;
    aliceRoundWins?: number;
    bobRoundWins?: number;
    result?: ReturnType<typeof makeMemoryPathMatchResult> | null;
  } = {},
) {
  const stateOptions: Parameters<typeof makeMemoryPathState>[1] = {
    matchResult: options.result ?? null,
  };
  if (options.pathVisible !== undefined) {
    stateOptions.pathVisible = options.pathVisible;
  }
  if (options.opponentsVisible !== undefined) {
    stateOptions.opponentsVisible = options.opponentsVisible;
  }
  if (options.aliceFalling !== undefined) {
    stateOptions.aliceFalling = options.aliceFalling;
  }
  if (options.aliceReconnecting !== undefined) {
    stateOptions.aliceReconnecting = options.aliceReconnecting;
  }
  if (options.suddenDeath !== undefined) {
    stateOptions.suddenDeath = options.suddenDeath;
  }
  if (options.aliceActive !== undefined) {
    stateOptions.aliceActive = options.aliceActive;
  }
  if (options.bobActive !== undefined) {
    stateOptions.bobActive = options.bobActive;
  }
  if (options.aliceRoundWins !== undefined) {
    stateOptions.aliceRoundWins = options.aliceRoundWins;
  }
  if (options.bobRoundWins !== undefined) {
    stateOptions.bobRoundWins = options.bobRoundWins;
  }
  const state = makeMemoryPathState(phase, {
    ...stateOptions,
  });
  const { connection } = makeRoomConnection(state);
  return {
    connection,
    state,
    selfSessionId: "host-session",
  };
}

function NarrowPhoneStory() {
  const args = makeArgs("preview");
  return (
    <Box sx={{ width: 320, height: "100dvh", overflow: "hidden" }}>
      <MemoryPathGameView
        connection={args.connection}
        state={args.state}
        selfSessionId={args.selfSessionId}
      />
    </Box>
  );
}

const meta = {
  title: "Games/Memory Path",
  component: MemoryPathGameView,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof MemoryPathGameView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Lobby: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeMemoryPathState>;
    selfSessionId: string;
  }) => <MemoryPathGameView {...args} />,
  args: makeArgs("lobby"),
};

export const Preparing: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeMemoryPathState>;
    selfSessionId: string;
  }) => <MemoryPathGameView {...args} />,
  args: makeArgs("preparing"),
};

export const Preview: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeMemoryPathState>;
    selfSessionId: string;
  }) => <MemoryPathGameView {...args} />,
  args: makeArgs("preview"),
};

export const RacingHidden: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeMemoryPathState>;
    selfSessionId: string;
  }) => <MemoryPathGameView {...args} />,
  args: makeArgs("racing"),
};

export const Flash: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeMemoryPathState>;
    selfSessionId: string;
  }) => <MemoryPathGameView {...args} />,
  args: makeArgs("racing", { pathVisible: true, opponentsVisible: true }),
};

export const Falling: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeMemoryPathState>;
    selfSessionId: string;
  }) => <MemoryPathGameView {...args} />,
  args: makeArgs("racing", {
    aliceFalling: true,
    pathVisible: false,
    opponentsVisible: false,
  }),
};

export const SpectatingSuddenDeath: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeMemoryPathState>;
    selfSessionId: string;
  }) => <MemoryPathGameView {...args} />,
  args: makeArgs("racing", {
    suddenDeath: true,
    aliceActive: true,
    bobActive: false,
    pathVisible: false,
    opponentsVisible: false,
  }),
};

export const Reconnecting: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeMemoryPathState>;
    selfSessionId: string;
  }) => <MemoryPathGameView {...args} />,
  args: makeArgs("racing", { aliceReconnecting: true }),
};

export const RoundResult: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeMemoryPathState>;
    selfSessionId: string;
  }) => <MemoryPathGameView {...args} />,
  args: makeArgs("round-result", {
    aliceRoundWins: 2,
    bobRoundWins: 1,
  }),
};

export const TimeoutResult: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeMemoryPathState>;
    selfSessionId: string;
  }) => {
    const state = args.state;
    state.roundResult = makeMemoryPathRoundResult({
      reason: "timeout",
      winnerProgress: 87,
    });
    return <MemoryPathGameView {...args} />;
  },
  args: makeArgs("round-result"),
};

export const MatchResult: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeMemoryPathState>;
    selfSessionId: string;
  }) => <MemoryPathGameView {...args} />,
  args: makeArgs("match-result", {
    result: makeMemoryPathMatchResult(),
    aliceRoundWins: 3,
    bobRoundWins: 0,
  }),
};

export const SuddenDeathMatchResult: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeMemoryPathState>;
    selfSessionId: string;
  }) => <MemoryPathGameView {...args} />,
  args: makeArgs("match-result", {
    result: makeMemoryPathMatchResult({ suddenDeathUsed: true, aliceWins: 2, bobWins: 1 }),
    aliceRoundWins: 2,
    bobRoundWins: 1,
    suddenDeath: true,
  }),
};

export const NarrowPhone: Story = {
  render: () => <NarrowPhoneStory />,
  args: makeArgs("preview"),
};
