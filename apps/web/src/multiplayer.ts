import { Client } from "@colyseus/sdk";

import { webConfig } from "./config.js";

export function createColyseusClient(): Client {
  // Colyseus 0.17 uses one pathname for HTTP matchmaking and WebSocket URLs.
  // Matchmaking stays at the root, while room sockets are prefixed with
  // COLYSEUS_PATH so the server can route upgrades without CORS.
  return new Client(window.location.origin, {
    urlBuilder: (url) => {
      if (url.protocol === "ws:" || url.protocol === "wss:") {
        url.pathname = `${webConfig.colyseusPath}${url.pathname}`;
      }
      return url.toString();
    },
  });
}
