import type { Meta, StoryObj } from "@storybook/react-vite";

import { makeCapitalPinState, makeMatchResult, makeRoomConnection } from "./fixtures.js";
import { CapitalPinGameView } from "./game-view.js";

function LobbyStory() {
  const state = makeCapitalPinState("lobby");
  const { connection } = makeRoomConnection(state);
  return <CapitalPinGameView connection={connection} state={state} selfSessionId="host-session" />;
}

function FinishedStory() {
  const state = makeCapitalPinState("finished", { result: makeMatchResult() });
  const { connection } = makeRoomConnection(state);
  return <CapitalPinGameView connection={connection} state={state} selfSessionId="host-session" />;
}

const meta = {
  title: "Games/Capital Pin",
  component: CapitalPinGameView,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof CapitalPinGameView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Lobby: Story = {
  render: () => <LobbyStory />,
  args: {
    connection: makeRoomConnection(makeCapitalPinState("lobby")).connection,
    state: makeCapitalPinState("lobby"),
    selfSessionId: "host-session",
  },
};

export const Finished: Story = {
  render: () => <FinishedStory />,
  args: {
    connection: makeRoomConnection(makeCapitalPinState("finished")).connection,
    state: makeCapitalPinState("finished", { result: makeMatchResult() }),
    selfSessionId: "host-session",
  },
};
