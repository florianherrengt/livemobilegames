import type { Decorator, Preview } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";

import { AppProviders } from "../src/app-providers.js";
import { createAppQueryClient } from "../src/query-client.js";

const queryClient = createAppQueryClient();

const withAppProviders: Decorator = (Story) => (
  <AppProviders queryClient={queryClient}>
    <MemoryRouter>
      <Story />
    </MemoryRouter>
  </AppProviders>
);

const preview: Preview = {
  decorators: [withAppProviders],
  parameters: {
    a11y: {
      test: "error",
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    layout: "centered",
  },
  tags: ["autodocs"],
};

export default preview;
