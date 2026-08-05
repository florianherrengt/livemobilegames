import type { Meta, StoryObj } from "@storybook/react-vite";

import { GameSelectForm } from "./game-select-form.js";

const games = [
  {
    id: "capital-pin",
    name: "Capital Pin",
    description: "Drop your pin where you think each capital city is.",
    version: 1,
    minPlayers: 2,
    maxPlayers: 8,
    orientation: "portrait",
  },
] as const;

const meta = {
  title: "Room/Game selection",
  component: GameSelectForm,
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof GameSelectForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const HostSelecting: Story = {
  args: {
    games,
    selectedGameId: "",
    isHost: true,
    onSelect: () => undefined,
  },
};

export const HostSelected: Story = {
  args: {
    games,
    selectedGameId: "capital-pin",
    isHost: true,
    onSelect: () => undefined,
  },
};

export const GuestWaiting: Story = {
  args: {
    games,
    selectedGameId: "",
    isHost: false,
    onSelect: () => undefined,
  },
};

export const GuestSelected: Story = {
  args: {
    games,
    selectedGameId: "capital-pin",
    isHost: false,
    onSelect: () => undefined,
  },
};
