import type { Meta, StoryObj } from "@storybook/react-vite";

import { HowToPlay } from "./how-to-play.js";

const meta = {
  title: "Room/How to play",
  component: HowToPlay,
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof HowToPlay>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: "How to play",
    points: ["Tap to move.", "Avoid the danger tiles.", "Last player standing wins."],
  },
};
