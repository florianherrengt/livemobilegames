import { buildInviteUrl, MultiplayerClient, renderQrCode } from "@falling-platforms/client-sdk";
import type { TapRaceClientState, TapRaceCommand } from "@falling-platforms/tap-race";

import "./styles.css";

const NAME_STORAGE_KEY = "tap-race:name";

function defaultServerUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  if (window.location.port === "5174") {
    return `${protocol}//${window.location.hostname}:2567`;
  }
  return `${protocol}//${window.location.host}`;
}

const serverUrl =
  (import.meta.env.VITE_GAME_SERVER_URL as string | undefined) || defaultServerUrl();

const client = new MultiplayerClient<TapRaceClientState, TapRaceCommand>({
  serverUrl,
  storageKey: "tap-race:connection",
});

let intentionalLeave = false;
let timerHandle: number | null = null;

const app = getElement<HTMLDivElement>("app");

app.innerHTML = `
  <section id="home-screen" class="screen visible">
    <h1>Tap Race</h1>
    <p>Tap as fast as you can when the match starts.</p>
    <label class="field-label" for="name-input">Your name</label>
    <input id="name-input" class="field" type="text" autocomplete="off" maxlength="20" placeholder="Display name" />
    <button id="create-button" class="button primary" type="button">Create room</button>
    <div>or</div>
    <label class="field-label" for="code-input">Room code</label>
    <input id="code-input" class="field" type="text" autocomplete="off" autocapitalize="characters" maxlength="6" placeholder="ABCDE" />
    <button id="join-button" class="button" type="button">Join room</button>
    <p id="home-error" class="error" role="alert"></p>
    <p id="home-hint" class="hint" hidden></p>
  </section>

  <section id="lobby-screen" class="screen">
    <h1>Tap Race</h1>
    <div class="lobby-code-row">
      <span class="lobby-code-label">Room</span>
      <span id="lobby-code" class="lobby-code"></span>
      <button id="copy-button" class="button" type="button">Copy</button>
    </div>
    <div class="invite-panel">
      <div class="invite-row">
        <input id="invite-url" class="invite-url" type="text" readonly aria-label="Invite link" />
        <button id="copy-invite-button" class="button" type="button">Copy link</button>
      </div>
      <div id="invite-qr" class="invite-qr"></div>
    </div>
    <h2>Players</h2>
    <ul id="player-list" class="player-list"></ul>
    <button id="ready-button" class="button" type="button">Mark ready</button>
    <button id="start-button" class="button primary" type="button" disabled>Start match</button>
    <button id="leave-button" class="button leave" type="button">Leave room</button>
  </section>

  <section id="play-screen" class="screen">
    <h1>Tap Race</h1>
    <p id="phase-label" class="status-line"></p>
    <button id="tap-button" class="tap-button" type="button" disabled>TAP</button>
    <h2>Scores</h2>
    <ul id="score-list" class="scores"></ul>
    <button id="play-leave-button" class="button leave" type="button">Leave room</button>
  </section>

  <section id="results-screen" class="screen">
    <h1>Tap Race</h1>
    <h2>Results</h2>
    <ul id="leaderboard" class="scores"></ul>
    <button id="play-again-button" class="button primary" type="button">Play again</button>
    <button id="results-leave-button" class="button leave" type="button">Leave room</button>
  </section>

  <div id="reconnecting-overlay">Reconnecting…</div>
`;

const homeScreen = getElement("home-screen");
const lobbyScreen = getElement("lobby-screen");
const playScreen = getElement("play-screen");
const resultsScreen = getElement("results-screen");
const reconnectingOverlay = getElement("reconnecting-overlay");
const homeError = getElement<HTMLParagraphElement>("home-error");
const homeHint = getElement<HTMLParagraphElement>("home-hint");
const nameInput = getElement<HTMLInputElement>("name-input");
const codeInput = getElement<HTMLInputElement>("code-input");
const lobbyCode = getElement("lobby-code");
const inviteUrlInput = getElement<HTMLInputElement>("invite-url");
const inviteQr = getElement("invite-qr");
const playerList = getElement<HTMLUListElement>("player-list");
const readyButton = getElement<HTMLButtonElement>("ready-button");
const startButton = getElement<HTMLButtonElement>("start-button");
const phaseLabel = getElement("phase-label");
const tapButton = getElement<HTMLButtonElement>("tap-button");
const scoreList = getElement<HTMLUListElement>("score-list");
const leaderboardList = getElement<HTMLUListElement>("leaderboard");

nameInput.value = localStorage.getItem(NAME_STORAGE_KEY) ?? "";

// Auto-connect when handed off from the launcher via ?name=&code=, or when an
// invite link (?code=) is opened: join with the saved name when available,
// otherwise pre-fill the code and let the visitor enter a name.
(() => {
  const params = new URLSearchParams(window.location.search);
  const handOffName = params.get("name");
  const handOffCode = params.get("code")?.toUpperCase() ?? "";
  if (handOffName) {
    nameInput.value = handOffName;
    localStorage.setItem(NAME_STORAGE_KEY, handOffName);
    if (handOffCode) {
      codeInput.value = handOffCode;
      client
        .joinRoom({ roomCode: handOffCode, name: handOffName })
        .catch((error: unknown) => showError(messageOf(error)));
    } else {
      client
        .createRoom({ gameId: "tap_race", name: handOffName })
        .catch((error: unknown) => showError(messageOf(error)));
    }
    return;
  }
  if (!handOffCode) return;
  codeInput.value = handOffCode;
  const savedName = localStorage.getItem(NAME_STORAGE_KEY) ?? "";
  if (savedName) {
    client
      .joinRoom({ roomCode: handOffCode, name: savedName })
      .catch((error: unknown) => prefillJoin(handOffCode, messageOf(error)));
  } else {
    prefillJoin(handOffCode);
  }
})();

getElement<HTMLButtonElement>("create-button").addEventListener("click", () => {
  const name = readName();
  if (!name) {
    showError("Enter a display name first");
    return;
  }
  client
    .createRoom({ gameId: "tap_race", name })
    .catch((error: unknown) => showError(messageOf(error)));
});

getElement<HTMLButtonElement>("join-button").addEventListener("click", () => {
  const name = readName();
  const code = codeInput.value.trim();
  if (!name) {
    showError("Enter a display name first");
    return;
  }
  if (!code) {
    showError("Enter a room code");
    return;
  }
  client.joinRoom({ roomCode: code, name }).catch((error: unknown) => showError(messageOf(error)));
});

getElement<HTMLButtonElement>("copy-button").addEventListener("click", () => {
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(lobbyCode.textContent ?? "").catch(() => {
      // The code stays visible on screen when the clipboard is unavailable.
    });
  }
});

getElement<HTMLButtonElement>("copy-invite-button").addEventListener("click", () => {
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(inviteUrlInput.value).catch(() => {
      // The link stays visible on screen when the clipboard is unavailable.
    });
  }
});

readyButton.addEventListener("click", () => {
  const snapshot = client.getLobbySnapshot();
  const self = snapshot?.players.find((player) => player.sessionId === snapshot.selfSessionId);
  void client.setReady(!self?.isReady).catch((error: unknown) => showError(messageOf(error)));
});

startButton.addEventListener("click", () => {
  void client.startGame().catch((error: unknown) => showError(messageOf(error)));
});

tapButton.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  client.sendGameCommand({ type: "tap" });
});

getElement<HTMLButtonElement>("play-again-button").addEventListener("click", () => {
  void client.playAgain().catch((error: unknown) => showError(messageOf(error)));
});

for (const id of ["leave-button", "play-leave-button", "results-leave-button"]) {
  getElement<HTMLButtonElement>(id).addEventListener("click", () => {
    intentionalLeave = true;
    void client.leave();
  });
}

client.onConnectionChange((status) => {
  reconnectingOverlay.classList.toggle("visible", status === "reconnecting");
  if (status === "disconnected") {
    showHome(intentionalLeave ? undefined : "Lost connection to the server");
    intentionalLeave = false;
  }
});

client.onError((payload) => {
  showError(payload.error.message);
});

client.onStateChange(() => render());

function render(): void {
  const state = client.getState();
  if (!state) {
    return;
  }
  app.dataset.phase = state.phase;
  app.dataset.sessionId = client.getMembership()?.sessionId ?? "";

  if (state.status === "lobby") {
    renderLobby();
    return;
  }
  if (state.status === "finished" && state.phase === "finished") {
    renderResults();
    return;
  }
  renderPlay(state);
}

function renderLobby(): void {
  const snapshot = client.getLobbySnapshot();
  if (!snapshot) {
    return;
  }
  showScreen(lobbyScreen);
  lobbyCode.textContent = snapshot.roomCode;
  const inviteUrl = buildInviteUrl(snapshot.roomCode, window.location.href);
  inviteUrlInput.value = inviteUrl;
  if (renderedInviteCode !== snapshot.roomCode) {
    renderedInviteCode = snapshot.roomCode;
    void renderQrCode(inviteQr, inviteUrl).catch(() => {
      // QR rendering is best-effort; the invite link remains available.
    });
  }
  playerList.replaceChildren(
    ...snapshot.players.map((player) => {
      const row = document.createElement("li");
      row.className = "player-row";
      if (player.connectionStatus !== "connected") {
        row.classList.add("reconnecting");
      }
      const name = document.createElement("span");
      name.className = "player-name";
      name.textContent = player.name;
      row.append(name);
      if (player.isHost) {
        row.append(badge("host", "host"));
      }
      if (player.sessionId === snapshot.selfSessionId) {
        row.append(badge("you", "you"));
      }
      if (player.isReady) {
        row.append(badge("ready", "ready"));
      }
      return row;
    }),
  );
  const self = snapshot.players.find((player) => player.sessionId === snapshot.selfSessionId);
  readyButton.textContent = self?.isReady ? "Not ready" : "Mark ready";
  startButton.disabled = !snapshot.canStart;
  startButton.textContent = snapshot.canStart
    ? "Start match"
    : snapshot.isHost
      ? `Waiting for ${snapshot.minPlayers - snapshot.players.length} more player(s) / ready states`
      : "Waiting for the host…";
}

function renderPlay(state: TapRaceClientState): void {
  showScreen(playScreen);
  const membership = client.getMembership();
  const sessionId = membership?.sessionId ?? "";
  const self = state.players.get(sessionId);
  const scores = [...state.players.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .map(([playerSessionId, player]) => ({
      sessionId: playerSessionId,
      name: player.name,
      score: player.score,
    }));
  scoreList.replaceChildren(
    ...scores.map(({ sessionId: id, name, score }) => {
      const row = document.createElement("li");
      row.className = "score-row";
      if (id === sessionId) {
        row.classList.add("self");
      }
      const label = document.createElement("span");
      label.textContent = name;
      const value = document.createElement("span");
      value.textContent = String(score);
      value.dataset.score = String(score);
      row.append(label, value);
      return row;
    }),
  );

  const playing = state.phase === "playing";
  tapButton.disabled = !playing;
  tapButton.textContent = playing ? "TAP" : state.phase === "countdown" ? "GET READY" : "…";
  if (timerHandle !== null) {
    window.clearInterval(timerHandle);
  }
  timerHandle = window.setInterval(() => {
    const latest = client.getState();
    if (!latest || latest.phase === "lobby" || latest.phase === "finished") {
      if (timerHandle !== null) {
        window.clearInterval(timerHandle);
        timerHandle = null;
      }
      return;
    }
    const now = client.getEstimatedServerTime() ?? Date.now();
    if (latest.phase === "countdown" && latest.startsAt > 0) {
      phaseLabel.textContent = `Match starts in ${Math.max(0, Math.ceil((latest.startsAt - now) / 1000))}…`;
    } else if (latest.phase === "playing" && latest.endsAt > 0) {
      phaseLabel.textContent = `${Math.max(0, Math.ceil((latest.endsAt - now) / 1000))}s left — ${self?.score ?? 0} taps`;
    }
  }, 100);
}

function renderResults(): void {
  showScreen(resultsScreen);
  const state = client.getState();
  if (!state?.result) {
    return;
  }
  const result = state.result as unknown as {
    winnerSessionIds: string[];
    leaderboard: Array<{ sessionId: string; rank: number; primaryScore: number; label: string }>;
  };
  leaderboardList.replaceChildren(
    ...result.leaderboard.map((entry) => {
      const row = document.createElement("li");
      row.className = "score-row";
      const rank = document.createElement("span");
      rank.className = "leaderboard-rank";
      rank.textContent = `#${entry.rank}`;
      const label = document.createElement("span");
      label.textContent = entry.label;
      const score = document.createElement("span");
      score.textContent = `${entry.primaryScore} taps`;
      row.append(rank, label, score);
      return row;
    }),
  );
  const snapshot = client.getLobbySnapshot();
  const playAgainButton = getElement<HTMLButtonElement>("play-again-button");
  playAgainButton.disabled = !snapshot?.isHost;
  playAgainButton.textContent = snapshot?.isHost ? "Play again" : "Waiting for the host…";
}

function badge(kind: "host" | "you" | "ready", text: string): HTMLSpanElement {
  const element = document.createElement("span");
  element.className = `badge ${kind}`;
  element.textContent = text;
  return element;
}

function showScreen(screen: HTMLElement): void {
  for (const candidate of [homeScreen, lobbyScreen, playScreen, resultsScreen]) {
    candidate.classList.toggle("visible", candidate === screen);
  }
  homeError.textContent = "";
  homeHint.hidden = true;
}

function showHome(error?: string): void {
  if (timerHandle !== null) {
    window.clearInterval(timerHandle);
    timerHandle = null;
  }
  showScreen(homeScreen);
  if (error) {
    homeError.textContent = error;
  }
}

function prefillJoin(code: string, error?: string): void {
  showScreen(homeScreen);
  codeInput.value = code;
  homeHint.textContent = `Enter your name to join room ${code}`;
  homeHint.hidden = false;
  if (error) {
    homeError.textContent = error;
  }
}

function showError(message: string): void {
  homeError.textContent = message;
}

function readName(): string {
  const name = nameInput.value.trim();
  if (name) {
    localStorage.setItem(NAME_STORAGE_KEY, name);
  }
  return name;
}

function messageOf(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }
  return "Could not reach the game server";
}

function getElement<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element #${id}`);
  }
  return element as T;
}

let renderedInviteCode = "";

showHome();
