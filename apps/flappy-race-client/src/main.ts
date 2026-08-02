import type Phaser from "phaser";

import { createGame } from "./game/createGame.js";
import { GameClient } from "./networking/GameClient.js";
import { type ScreensApi, setupScreens } from "./ui/screens.js";
import "./styles.css";

function messageFrom(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Could not reach the game server";
}

function defaultServerUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  if (window.location.port === "5177") {
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
        // The code stays visible on screen when the clipboard is unavailable.
      });
    }
  },
  onCopyInvite: (url) => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).catch(() => {
        // The invite link stays visible when the clipboard is unavailable.
      });
    }
  },
  onStartMatch: () => {
    client.startMatch();
  },
  onPlayAgain: () => {
    client.playAgain();
  },
  onLeaveRoom: () => {
    void client.leave();
  },
});

// Auto-connect when handed off from the hub via ?name=&code=, or when an invite
// link (?code=) is opened.
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
  if (!code) {
    return;
  }
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
  const sessionId = client.sessionId;
  if (state.status === "lobby" && state.phase === "lobby") {
    screens.showLobby(state, sessionId);
    screens.hideResults();
    screens.hideRoundResult();
    screens.hideCountdown();
  } else if (state.status === "finished" && state.phase === "finished") {
    screens.hideCountdown();
    screens.hideRoundResult();
    screens.showResults(state, sessionId);
  } else {
    screens.showGame();
    screens.updateGameStatus(state, sessionId);
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
  screens.hideCountdown();
  screens.hideRoundResult();
  screens.hideResults();
  screens.showHome(client.didLeaveIntentionally ? undefined : "Lost connection to the server");
});

// Server-driven countdown and round-result overlays.
setInterval(() => {
  const state = client.getState();
  if (!state) {
    return;
  }
  if (state.phase === "countdown" && state.countdownEndsAt > 0) {
    const now = client.getEstimatedServerTime() ?? Date.now();
    const remaining = Math.max(0, state.countdownEndsAt - now);
    screens.showCountdown(String(Math.max(1, Math.ceil(remaining / 1000))), state);
  } else {
    screens.hideCountdown();
  }
  if (state.phase === "round-result") {
    screens.showRoundResult(state, client.sessionId);
  } else {
    screens.hideRoundResult();
  }
}, 100);

screens.showHome();
