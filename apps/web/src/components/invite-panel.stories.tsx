import type { Meta, StoryObj } from "@storybook/react-vite";

import { InvitePanel } from "./invite-panel.js";

const meta = {
  title: "Room/Invite panel",
  component: InvitePanel,
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof InvitePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    code: "ABC234",
  },
};
