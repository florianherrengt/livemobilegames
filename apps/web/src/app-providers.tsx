import { CssBaseline, ThemeProvider } from "@mui/material";
import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { RoomConnectionProvider } from "./game-connection.js";
import { appTheme } from "./theme.js";

export function AppProviders({
  children,
  queryClient,
}: {
  children: ReactNode;
  queryClient: QueryClient;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={appTheme}>
        <CssBaseline />
        <RoomConnectionProvider>{children}</RoomConnectionProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
