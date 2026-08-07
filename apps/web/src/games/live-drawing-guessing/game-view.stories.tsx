import { Box } from "@mui/material";
import {
  LIVE_DRAWING_GUESSING_MESSAGE_TYPES,
  type LiveDrawingGuessingState,
} from "@phone-party/protocol";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";

import type { RoomConnection } from "../../game-connection.js";
import { makeLiveDrawingGuessingState, makeRoomConnection } from "./fixtures.js";
import { LiveDrawingGuessingGameView } from "./game-view.js";

function makeArgs(
  phase: "lobby" | "preparing" | "drawing" | "result" | "round-summary" | "finished",
  options: {
    selfSessionId?: string;
    bobSpectator?: boolean;
    result?: "solved" | "timeout" | "skipped" | "no-guessers";
    tie?: boolean;
  } = {},
) {
  const state = makeLiveDrawingGuessingState(phase, {
    bobSpectator: options.bobSpectator,
    result: options.result,
    tie: options.tie,
  });
  const selfSessionId = options.selfSessionId ?? "alice-session";
  const { connection, emit } = makeRoomConnection(state, selfSessionId);
  return { connection, state, selfSessionId, emit };
}

function WithBriefing({ args, children }: { args: StoryArgs; children: React.ReactNode }) {
  useEffect(() => {
    const emit = (args as StoryArgs & { emit: (type: string, payload: unknown) => void }).emit;
    emit(LIVE_DRAWING_GUESSING_MESSAGE_TYPES.drawerBriefing, {
      word: "penguin",
      category: "Animal",
      turnNumber: 1,
      roundNumber: 1,
      letterCount: 7,
    });
  }, [args]);
  return <>{children}</>;
}

const meta = {
  title: "Games/Live Drawing & Guessing",
  component: LiveDrawingGuessingGameView,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof LiveDrawingGuessingGameView>;

export default meta;
type Story = StoryObj<typeof meta>;
type StoryArgs = {
  connection: RoomConnection;
  state: LiveDrawingGuessingState;
  selfSessionId: string;
};

function render(args: StoryArgs) {
  return (
    <LiveDrawingGuessingGameView
      connection={args.connection}
      state={args.state}
      selfSessionId={args.selfSessionId}
    />
  );
}

export const Lobby: Story = {
  render,
  args: makeArgs("lobby"),
};

export const PreparingDrawer: Story = {
  render: (args: StoryArgs) => <WithBriefing args={args}>{render(args)}</WithBriefing>,
  args: makeArgs("preparing"),
};

export const PreparingGuesser: Story = {
  render,
  args: makeArgs("preparing", { selfSessionId: "bob-session" }),
};

export const DrawingDrawer: Story = {
  render: (args: StoryArgs) => <WithBriefing args={args}>{render(args)}</WithBriefing>,
  args: makeArgs("drawing"),
};

export const DrawingGuesser: Story = {
  render,
  args: makeArgs("drawing", { selfSessionId: "bob-session" }),
};

export const DrawingSpectator: Story = {
  render,
  args: makeArgs("drawing", { selfSessionId: "bob-session", bobSpectator: true }),
};

export const ResultSolved: Story = {
  render,
  args: makeArgs("result", { result: "solved" }),
};

export const ResultTimeout: Story = {
  render,
  args: makeArgs("result", { result: "timeout" }),
};

export const RoundSummary: Story = {
  render,
  args: makeArgs("round-summary"),
};

export const Finished: Story = {
  render,
  args: makeArgs("finished"),
};

export const TiedFinished: Story = {
  render,
  args: makeArgs("finished", { tie: true }),
};

export const NarrowPhoneDrawer: Story = {
  render: () => {
    const args = makeArgs("drawing");
    return (
      <Box sx={{ width: 320, height: "100dvh", overflow: "hidden" }}>
        <WithBriefing args={args}>{render(args)}</WithBriefing>
      </Box>
    );
  },
  args: makeArgs("drawing"),
};
