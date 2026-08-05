import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { App } from "./app.js";
import { AppProviders } from "./app-providers.js";
import { createAppQueryClient } from "./query-client.js";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("Missing #root element");
}

const queryClient = createAppQueryClient();

createRoot(root).render(
  <StrictMode>
    <AppProviders queryClient={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AppProviders>
  </StrictMode>,
);
