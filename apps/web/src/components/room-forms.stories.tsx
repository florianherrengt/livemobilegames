import { Stack } from "@mui/material";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { CreateRoomForm } from "./create-room-form.js";
import { JoinRoomForm } from "./join-room-form.js";

function RoomForms() {
  return (
    <Stack spacing={2} sx={{ width: "min(100%, 560px)" }}>
      <CreateRoomForm />
      <JoinRoomForm />
    </Stack>
  );
}

const meta = {
  title: "Room/Create and join forms",
  component: RoomForms,
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof RoomForms>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
