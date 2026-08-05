import type { HttpBindings } from "@hono/node-server";

export type AppEnv = {
  Bindings: Partial<HttpBindings>;
  Variables: {
    playerId: string;
    requestId: string;
  };
};
