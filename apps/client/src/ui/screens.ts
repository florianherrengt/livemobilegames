import { buildInviteUrl, renderQrCode } from "@falling-platforms/client-sdk";
import { type ClientGameState, NAME_MAX_LENGTH } from "@falling-platforms/shared";

export type ScreenHandlers = {
  onCreateRoom: (name: string) => void;
  onJoinRoom: (name: string, code: string) => void;
  onCopyCode: (code: string) => void;
  onCopyInvite: (url: string) => void;
  onStartMatch: () => void;
  onLeaveRoom: () => void;
};

export type ScreensApi = {
  showHome: (error?: string) => void;
  showLobby: (state: ClientGameState, localSessionId: string) => void;
  showGame: () => void;
  updateGameStatus: (state: ClientGameState, localSessionId: string) => void;
  setReconnecting: (reconnecting: boolean) => void;
  showCountdown: (label: string) => void;
  hideCountdown: () => void;
  showResults: (state: ClientGameState) => void;
  hideResults: () => void;
  prefillJoin: (code: string, error?: string) => void;
  getSavedName: () => string;
};

const STORAGE_KEY = "falling-platforms-name";

export function setupScreens(handlers: ScreenHandlers): ScreensApi {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) {
    throw new Error("#app element not found");
  }
  let renderedInviteCode = "";

  app.innerHTML = `
    <section id="home-screen" class="screen">
      <h1 class="title">Falling Platforms</h1>
      <p class="tagline">Swipe up, down, left or right to hop. Don't fall.</p>
      <label class="field-label" for="name-input">Your name</label>
      <input
        id="name-input"
        class="field"
        type="text"
        inputmode="text"
        autocomplete="off"
        maxlength="${NAME_MAX_LENGTH}"
        placeholder="Display name"
      />
      <button id="create-button" class="button primary" type="button">Create room</button>
      <div class="divider"><span>or</span></div>
      <label class="field-label" for="code-input">Room code</label>
      <input
        id="code-input"
        class="field code-field"
        type="text"
        inputmode="text"
        autocomplete="off"
        autocapitalize="characters"
        maxlength="5"
        placeholder="ABCDE"
      />
      <button id="join-button" class="button" type="button">Join room</button>
      <p id="home-error" class="error hidden" role="alert"></p>
      <p id="home-hint" class="hint hidden"></p>
    </section>

    <section id="lobby-screen" class="screen hidden">
      <h1 class="title">Falling Platforms</h1>
      <div class="lobby-code-row">
        <span class="lobby-code-label">Room</span>
        <span id="lobby-code" class="lobby-code"></span>
        <button id="copy-button" class="button small" type="button">Copy</button>
      </div>
      <div class="invite-panel">
        <div class="invite-row">
          <input id="invite-url" class="invite-url" type="text" readonly aria-label="Invite link" />
          <button id="copy-invite-button" class="button small" type="button">Copy link</button>
        </div>
        <div id="invite-qr" class="invite-qr"></div>
      </div>
      <h2 class="section-title">Players</h2>
      <ul id="player-list" class="player-list"></ul>
      <button id="start-button" class="button primary hidden" type="button">Start</button>
      <p id="waiting-message" class="waiting">Waiting for the host to start…</p>
      <button id="leave-button" class="button leave-button" type="button">Leave room</button>
    </section>

    <section id="game-screen" class="screen game-screen hidden">
      <div id="game-container"></div>
      <div id="hud">
        <span id="hud-room" class="hud-chip"></span>
        <span id="hud-alive" class="hud-chip"></span>
        <span id="hud-spectating" class="hud-chip hidden">Spectating</span>
        <span id="hud-reconnecting" class="hud-chip reconnecting hidden">Reconnecting…</span>
      </div>
      <div id="countdown-overlay" class="overlay hidden"></div>
      <div id="results-overlay" class="overlay hidden">
        <div id="results-text" class="results-text"></div>
        <div id="results-sub" class="results-sub"></div>
      </div>
    </section>

    <div id="landscape-overlay" class="landscape-overlay">
      <p>Rotate your phone to portrait to play</p>
    </div>
  `;

  const homeScreen = getElement<HTMLElement>("home-screen");
  const lobbyScreen = getElement<HTMLElement>("lobby-screen");
  const gameScreen = getElement<HTMLElement>("game-screen");
  const nameInput = getElement<HTMLInputElement>("name-input");
  const codeInput = getElement<HTMLInputElement>("code-input");
  const homeError = getElement<HTMLElement>("home-error");
  const homeHint = getElement<HTMLElement>("home-hint");
  const lobbyCode = getElement<HTMLElement>("lobby-code");
  const inviteUrlInput = getElement<HTMLInputElement>("invite-url");
  const inviteQr = getElement<HTMLElement>("invite-qr");
  const playerList = getElement<HTMLUListElement>("player-list");
  const startButton = getElement<HTMLButtonElement>("start-button");
  const waitingMessage = getElement<HTMLElement>("waiting-message");
  const hudRoom = getElement<HTMLElement>("hud-room");
  const hudAlive = getElement<HTMLElement>("hud-alive");
  const hudSpectating = getElement<HTMLElement>("hud-spectating");
  const hudReconnecting = getElement<HTMLElement>("hud-reconnecting");
  const countdownOverlay = getElement<HTMLElement>("countdown-overlay");
  const resultsOverlay = getElement<HTMLElement>("results-overlay");
  const resultsText = getElement<HTMLElement>("results-text");
  const resultsSub = getElement<HTMLElement>("results-sub");

  nameInput.value = localStorage.getItem(STORAGE_KEY) ?? "";

  getElement<HTMLButtonElement>("create-button").addEventListener("click", () => {
    const name = readName();
    if (!name) {
      showError("Enter a display name first");
      return;
    }
    localStorage.setItem(STORAGE_KEY, name);
    handlers.onCreateRoom(name);
  });

  getElement<HTMLButtonElement>("join-button").addEventListener("click", () => {
    const name = readName();
    if (!name) {
      showError("Enter a display name first");
      return;
    }
    const code = codeInput.value.trim();
    if (!code) {
      showError("Enter a room code");
      return;
    }
    localStorage.setItem(STORAGE_KEY, name);
    handlers.onJoinRoom(name, code);
  });

  getElement<HTMLButtonElement>("copy-button").addEventListener("click", () => {
    handlers.onCopyCode(lobbyCode.textContent ?? "");
  });

  getElement<HTMLButtonElement>("copy-invite-button").addEventListener("click", () => {
    handlers.onCopyInvite(inviteUrlInput.value);
  });

  startButton.addEventListener("click", () => {
    handlers.onStartMatch();
  });

  getElement<HTMLButtonElement>("leave-button").addEventListener("click", () => {
    handlers.onLeaveRoom();
  });

  function readName(): string {
    return nameInput.value.trim();
  }

  function showError(message: string): void {
    homeError.textContent = message;
    homeError.classList.remove("hidden");
  }

  return {
    showHome(error?: string): void {
      gameScreen.classList.add("hidden");
      lobbyScreen.classList.add("hidden");
      homeScreen.classList.remove("hidden");
      hideCountdown();
      hideResults();
      if (error) {
        showError(error);
      } else {
        homeError.classList.add("hidden");
      }
      homeHint.classList.add("hidden");
    },

    showLobby(state, localSessionId): void {
      homeScreen.classList.add("hidden");
      gameScreen.classList.add("hidden");
      lobbyScreen.classList.remove("hidden");
      renderLobby(state, localSessionId);
      updateDataAttributes(app, state, localSessionId);
    },

    showGame(): void {
      homeScreen.classList.add("hidden");
      lobbyScreen.classList.add("hidden");
      gameScreen.classList.remove("hidden");
    },

    updateGameStatus(state, localSessionId): void {
      const local = state.players.get(localSessionId);
      hudRoom.textContent = `Room ${state.roomCode}`;
      hudAlive.textContent = `Alive ${state.aliveCount}`;
      const spectating = state.phase !== "lobby" && (!local?.participating || !local.alive);
      hudSpectating.classList.toggle("hidden", !spectating);
      updateDataAttributes(app, state, localSessionId);
    },

    setReconnecting(reconnecting): void {
      hudReconnecting.classList.toggle("hidden", !reconnecting);
    },

    showCountdown(label): void {
      countdownOverlay.textContent = label;
      countdownOverlay.classList.remove("hidden");
    },

    hideCountdown(): void {
      countdownOverlay.classList.add("hidden");
    },

    showResults(state): void {
      if (state.draw) {
        resultsText.textContent = "Draw!";
        resultsSub.textContent = "Everyone fell. Back to the lobby…";
      } else {
        const winner = state.players.get(state.winnerSessionId);
        resultsText.textContent = winner ? `${winner.name} wins!` : "Winner!";
        resultsSub.textContent = "Back to the lobby…";
      }
      resultsOverlay.classList.remove("hidden");
    },

    hideResults(): void {
      resultsOverlay.classList.add("hidden");
    },

    prefillJoin(code, error): void {
      homeScreen.classList.remove("hidden");
      lobbyScreen.classList.add("hidden");
      gameScreen.classList.add("hidden");
      hideCountdown();
      hideResults();
      codeInput.value = code;
      homeHint.textContent = `Enter your name to join room ${code}`;
      homeHint.classList.remove("hidden");
      if (error) {
        homeError.textContent = error;
        homeError.classList.remove("hidden");
      } else {
        homeError.classList.add("hidden");
      }
    },

    getSavedName(): string {
      return localStorage.getItem(STORAGE_KEY) ?? "";
    },
  };

  function renderLobby(state: ClientGameState, localSessionId: string): void {
    lobbyCode.textContent = state.roomCode;
    const inviteUrl = buildInviteUrl(state.roomCode, window.location.href);
    inviteUrlInput.value = inviteUrl;
    if (renderedInviteCode !== state.roomCode) {
      renderedInviteCode = state.roomCode;
      void renderQrCode(inviteQr, inviteUrl).catch(() => {
        // QR rendering is best-effort; the invite link remains available.
      });
    }
    playerList.replaceChildren(
      ...[...state.players.entries()]
        .sort((a, b) => a[1].joinedOrder - b[1].joinedOrder)
        .map(([sessionId, player]) => {
          const item = document.createElement("li");
          item.className = "player-row";
          const name = document.createElement("span");
          name.className = "player-name";
          name.textContent = player.name;
          item.append(name);
          if (sessionId === state.hostSessionId) {
            const host = document.createElement("span");
            host.className = "player-host";
            host.textContent = "host";
            item.append(host);
          }
          if (sessionId === localSessionId) {
            const you = document.createElement("span");
            you.className = "player-you";
            you.textContent = "you";
            item.append(you);
          }
          if (!player.connected) {
            item.classList.add("disconnected");
          }
          return item;
        }),
    );
    const isHost = state.hostSessionId === localSessionId;
    startButton.classList.toggle("hidden", !isHost);
    waitingMessage.classList.toggle("hidden", isHost);
  }

  function hideCountdown(): void {
    countdownOverlay.classList.add("hidden");
  }

  function hideResults(): void {
    resultsOverlay.classList.add("hidden");
  }
}

function updateDataAttributes(
  app: HTMLElement,
  state: ClientGameState,
  localSessionId: string,
): void {
  const local = state.players.get(localSessionId);
  app.dataset.phase = state.phase;
  app.dataset.arenaSide = String(state.arenaSide);
  app.dataset.aliveCount = String(state.aliveCount);
  app.dataset.winnerSessionId = state.winnerSessionId;
  app.dataset.draw = String(state.draw);
  app.dataset.localAlive = String(local?.alive ?? false);
  app.dataset.localJumping = String(local?.jumping ?? false);
  app.dataset.localPlatform = local?.currentPlatformId ?? "";
  app.dataset.spectating = String(
    state.phase !== "lobby" && (!local?.participating || !local.alive),
  );
  app.dataset.warningCount = String(
    [...state.platforms.values()].filter((platform) => platform.state === "warning").length,
  );
  app.dataset.players = JSON.stringify(
    [...state.players.entries()].map(([sessionId, player]) => ({
      sessionId,
      name: player.name,
      alive: player.alive,
      jumping: player.jumping,
      currentPlatformId: player.currentPlatformId,
      targetPlatformId: player.targetPlatformId,
      isLocal: sessionId === localSessionId,
    })),
  );
}

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element #${id}`);
  }
  return element as T;
}
