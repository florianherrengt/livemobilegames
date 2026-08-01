import type Phaser from "phaser";

import { createGame } from "./game/createGame.js";
import { GameClient } from "./networking/GameClient.js";
import { type ScreensApi, setupScreens } from "./ui/screens.js";
import "./ui/styles.css";

function messageFrom(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Could not reach the game server";
}

// Default to the same origin the page was served from (production/e2e), or the
// local game-server port when running the Vite dev server on port 5173.
// Override with VITE_GAME_SERVER_URL when the server is elsewhere.
function defaultServerUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  if (window.location.port === "5173") {
    return `${protocol}//${window.location.hostname}:2567`;
  }
  return `${protocol}//${window.location.host}`;
}

const serverUrl =
  (import.meta.env.VITE_GAME_SERVER_URL as string | undefined) || defaultServerUrl();

const client = new GameClient(serverUrl);
let screens: ScreensApi;
let game: Phaser.Game | null = null;

screens = setupScreens({
  onCreateRoom: (name) => {
    client.createRoom(name).catch((error: unknown) => {
      screens.showHome(messageFrom(error));
    });
  },
  onJoinRoom: (name, code) => {
    client.joinRoom(name, code).catch((error: unknown) => {
      screens.showHome(messageFrom(error));
    });
  },
  onCopyCode: (code) => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(code).catch(() => {
        // Clipboard may be unavailable; the code stays visible on screen.
      });
    }
  },
  onCopyInvite: (url) => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).catch(() => {
        // Clipboard may be unavailable; the link stays visible on screen.
      });
    }
  },
  onStartMatch: () => {
    client.startMatch();
  },
  onLeaveRoom: () => {
    client.leave();
  },
});

// Auto-connect when handed off from the launcher via ?name=&code=, or when an
// invite link (?code=) is opened: join with the saved name when available,
// otherwise pre-fill the code and let the visitor enter a name.
(() => {
  const params = new URLSearchParams(window.location.search);
  const name = params.get("name");
  const code = params.get("code")?.toUpperCase() ?? "";
  if (name) {
    if (code) {
      client.joinRoom(name, code).catch((error: unknown) => {
        screens.showHome(messageFrom(error));
      });
    } else {
      client.createRoom(name).catch((error: unknown) => {
        screens.showHome(messageFrom(error));
      });
    }
    return;
  }
  if (!code) return;
  const savedName = screens.getSavedName();
  if (savedName) {
    client.joinRoom(savedName, code).catch((error: unknown) => {
      screens.prefillJoin(code, messageFrom(error));
    });
  } else {
    screens.prefillJoin(code);
  }
})();

client.onStateChange((state) => {
  if (!game) {
    game = createGame({ client, screens });
  }
  if (state.phase === "lobby") {
    screens.showLobby(state, client.sessionId);
    screens.hideResults();
    screens.hideCountdown();
  } else {
    screens.showGame();
    screens.updateGameStatus(state, client.sessionId);
  }
});

client.onDropped(() => {
  screens.setReconnecting(true);
});

client.onReconnected(() => {
  screens.setReconnecting(false);
});

client.onLeave(() => {
  screens.setReconnecting(false);
  screens.showHome(client.didLeaveIntentionally ? undefined : "Lost connection to the server");
});

screens.showHome();
