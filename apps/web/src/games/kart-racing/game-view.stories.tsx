import { Box } from "@mui/material";
import type { Meta, StoryObj } from "@storybook/react-vite";

import type { RoomConnection } from "../../game-connection.js";
import { makeKartRacingResult, makeKartRacingState, makeRoomConnection } from "./fixtures.js";
import { KartRacingGameView } from "./game-view.js";

function makeArgs(
  phase: "lobby" | "countdown" | "racing" | "race-result" | "finished",
  options: {
    aliceAmmo?: boolean;
    bobAmmo?: boolean;
    aliceFinished?: boolean;
    aliceHitStop?: boolean;
    aliceRespawn?: boolean;
    aliceReconnecting?: boolean;
    result?: ReturnType<typeof makeKartRacingResult> | null;
  } = {},
) {
  const state = makeKartRacingState(phase, {
    ...(options.aliceAmmo !== undefined ? { aliceAmmo: options.aliceAmmo } : {}),
    ...(options.bobAmmo !== undefined ? { bobAmmo: options.bobAmmo } : {}),
    ...(options.aliceFinished !== undefined ? { aliceFinished: options.aliceFinished } : {}),
    ...(options.aliceHitStop !== undefined ? { aliceHitStop: options.aliceHitStop } : {}),
    ...(options.aliceRespawn !== undefined ? { aliceRespawn: options.aliceRespawn } : {}),
    ...(options.aliceReconnecting !== undefined
      ? { aliceReconnecting: options.aliceReconnecting }
      : {}),
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
  const args = makeArgs("racing");
  return (
    <Box sx={{ width: 320, height: "100dvh", overflow: "hidden" }}>
      <KartRacingGameView
        connection={args.connection}
        state={args.state}
        selfSessionId={args.selfSessionId}
      />
    </Box>
  );
}

const meta = {
  title: "Games/Kart Racing",
  component: KartRacingGameView,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof KartRacingGameView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Lobby: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeKartRacingState>;
    selfSessionId: string;
  }) => <KartRacingGameView {...args} />,
  args: makeArgs("lobby"),
};

export const Countdown: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeKartRacingState>;
    selfSessionId: string;
  }) => <KartRacingGameView {...args} />,
  args: makeArgs("countdown"),
};

export const Racing: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeKartRacingState>;
    selfSessionId: string;
  }) => <KartRacingGameView {...args} />,
  args: makeArgs("racing", { aliceAmmo: true }),
};

export const HitStop: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeKartRacingState>;
    selfSessionId: string;
  }) => <KartRacingGameView {...args} />,
  args: makeArgs("racing", { aliceHitStop: true }),
};

export const Respawning: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeKartRacingState>;
    selfSessionId: string;
  }) => <KartRacingGameView {...args} />,
  args: makeArgs("racing", { aliceRespawn: true }),
};

export const FinishedRacer: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeKartRacingState>;
    selfSessionId: string;
  }) => <KartRacingGameView {...args} />,
  args: makeArgs("racing", { aliceFinished: true }),
};

export const Reconnecting: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeKartRacingState>;
    selfSessionId: string;
  }) => <KartRacingGameView {...args} />,
  args: makeArgs("racing", { aliceReconnecting: true }),
};

export const RaceResult: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeKartRacingState>;
    selfSessionId: string;
  }) => <KartRacingGameView {...args} />,
  args: makeArgs("race-result"),
};

export const Finished: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeKartRacingState>;
    selfSessionId: string;
  }) => <KartRacingGameView {...args} />,
  args: makeArgs("finished", { result: makeKartRacingResult() }),
};

export const TiedFinished: Story = {
  render: (args: {
    connection: RoomConnection;
    state: ReturnType<typeof makeKartRacingState>;
    selfSessionId: string;
  }) => <KartRacingGameView {...args} />,
  args: makeArgs("finished", { result: makeKartRacingResult({ tie: true }) }),
};

export const NarrowPhone: Story = {
  render: () => <NarrowPhoneStory />,
  args: makeArgs("racing"),
};
