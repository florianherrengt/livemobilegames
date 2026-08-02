import { buildInviteUrl, renderQrCode } from "@falling-platforms/client-sdk";
import { FLAPPY_RACE_CONFIG, type FlappyRaceClientState } from "@falling-platforms/flappy-race";

export type ScreenHandlers = {
  onCreateRoom: (name: string) => void;
  onJoinRoom: (name: string, code: string) => void;
  onCopyCode: (code: string) => void;
  onCopyInvite: (url: string) => void;
  onStartMatch: () => void;
  onPlayAgain: () => void;
  onLeaveRoom: () => void;
};

export type ScreensApi = {
  showHome: (error?: string) => void;
  showLobby: (state: FlappyRaceClientState, localSessionId: string) => void;
  showGame: () => void;
  updateGameStatus: (state: FlappyRaceClientState, localSessionId: string) => void;
  setReconnecting: (reconnecting: boolean) => void;
  showCountdown: (label: string, state: FlappyRaceClientState) => void;
  hideCountdown: () => void;
  showRoundResult: (state: FlappyRaceClientState, localSessionId: string) => void;
  hideRoundResult: () => void;
  showResults: (state: FlappyRaceClientState, localSessionId: string) => void;
  hideResults: () => void;
  prefillJoin: (code: string, error?: string) => void;
  getSavedName: () => string;
};

const STORAGE_KEY = "flappy-race:name";
const NAME_MAX_LENGTH = 20;

export function setupScreens(handlers: ScreenHandlers): ScreensApi {
  const app = getElement<HTMLDivElement>("app");
  let renderedInviteCode = "";

  app.innerHTML = `
    <section id="home-screen" class="screen">
      <h1 class="title">Flappy Race</h1>
      <p class="tagline">Tap to flap. Furthest bird wins each round. Five rounds decide the match.</p>
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
      <h1 class="title">Flappy Race</h1>
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
        <span id="hud-round" class="hud-chip"></span>
        <span id="hud-spectating" class="hud-chip hidden">Spectating</span>
        <span id="hud-reconnecting" class="hud-chip reconnecting hidden">Reconnecting…</span>
        <button id="game-leave-button" class="hud-button" type="button">Leave</button>
      </div>
      <div id="countdown-overlay" class="overlay hidden">
        <div id="countdown-number" class="countdown-number"></div>
        <div id="countdown-legend" class="countdown-legend"></div>
      </div>
      <div id="round-result-overlay" class="overlay hidden">
        <div id="round-result-title" class="round-result-title"></div>
        <div id="round-result-winners" class="round-result-winners"></div>
        <div id="round-result-scores" class="round-result-scores"></div>
      </div>
    </section>

    <section id="results-screen" class="screen hidden">
      <h1 class="title">Flappy Race</h1>
      <h2 class="section-title">Final scoreboard</h2>
      <ul id="leaderboard" class="leaderboard"></ul>
      <button id="play-again-button" class="button primary" type="button">Play again</button>
      <button id="results-leave-button" class="button leave-button" type="button">Leave room</button>
    </section>
  `;

  const homeScreen = getElement<HTMLElement>("home-screen");
  const lobbyScreen = getElement<HTMLElement>("lobby-screen");
  const gameScreen = getElement<HTMLElement>("game-screen");
  const resultsScreen = getElement<HTMLElement>("results-screen");
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
  const hudRound = getElement<HTMLElement>("hud-round");
  const hudSpectating = getElement<HTMLElement>("hud-spectating");
  const hudReconnecting = getElement<HTMLElement>("hud-reconnecting");
  const countdownOverlay = getElement<HTMLElement>("countdown-overlay");
  const countdownNumber = getElement<HTMLElement>("countdown-number");
  const countdownLegend = getElement<HTMLElement>("countdown-legend");
  const roundResultOverlay = getElement<HTMLElement>("round-result-overlay");
  const roundResultTitle = getElement<HTMLElement>("round-result-title");
  const roundResultWinners = getElement<HTMLElement>("round-result-winners");
  const roundResultScores = getElement<HTMLElement>("round-result-scores");
  const leaderboard = getElement<HTMLUListElement>("leaderboard");
  const playAgainButton = getElement<HTMLButtonElement>("play-again-button");

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

  playAgainButton.addEventListener("click", () => {
    handlers.onPlayAgain();
  });

  getElement<HTMLButtonElement>("game-leave-button").addEventListener("click", () => {
    handlers.onLeaveRoom();
  });

  getElement<HTMLButtonElement>("leave-button").addEventListener("click", () => {
    handlers.onLeaveRoom();
  });

  getElement<HTMLButtonElement>("results-leave-button").addEventListener("click", () => {
    handlers.onLeaveRoom();
  });

  function readName(): string {
    return nameInput.value.trim();
  }

  function showError(message: string): void {
    homeError.textContent = message;
    homeError.classList.remove("hidden");
  }

  function hideCountdown(): void {
    countdownOverlay.classList.add("hidden");
  }

  function hideRoundResult(): void {
    roundResultOverlay.classList.add("hidden");
  }

  return {
    showHome(error?: string): void {
      gameScreen.classList.add("hidden");
      lobbyScreen.classList.add("hidden");
      resultsScreen.classList.add("hidden");
      homeScreen.classList.remove("hidden");
      hideCountdown();
      hideRoundResult();
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
      resultsScreen.classList.add("hidden");
      lobbyScreen.classList.remove("hidden");
      renderLobby(state, localSessionId);
      updateDataAttributes(state, localSessionId);
    },

    showGame(): void {
      homeScreen.classList.add("hidden");
      lobbyScreen.classList.add("hidden");
      resultsScreen.classList.add("hidden");
      gameScreen.classList.remove("hidden");
    },

    updateGameStatus(state, localSessionId): void {
      const local = state.players.get(localSessionId);
      hudRound.textContent =
        state.roundNumber > 0
          ? `Round ${state.roundNumber}/${state.totalRounds}`
          : `Room ${state.roomCode}`;
      const spectating =
        (state.phase === "countdown" || state.phase === "running") &&
        (!local?.roundActive || local.matchRemoved);
      hudSpectating.classList.toggle("hidden", !spectating);
      updateDataAttributes(state, localSessionId);
    },

    setReconnecting(reconnecting): void {
      hudReconnecting.classList.toggle("hidden", !reconnecting);
    },

    showCountdown(label, state): void {
      countdownNumber.textContent = label;
      renderLegend(state);
      countdownOverlay.classList.remove("hidden");
    },

    hideCountdown(): void {
      countdownOverlay.classList.add("hidden");
    },

    showRoundResult(state, localSessionId): void {
      const winners = state.roundWinnerSessionIds
        .map((sessionId) => state.players.get(sessionId)?.name)
        .filter((name): name is string => Boolean(name));
      roundResultTitle.textContent = `Round ${state.roundNumber} result`;
      roundResultWinners.textContent =
        winners.length > 0
          ? `${winners.join(" & ")} ${winners.length > 1 ? "share the round win" : "wins the round"}`
          : "No winners this round";
      renderScores(state);
      roundResultOverlay.classList.remove("hidden");
      updateDataAttributes(state, localSessionId);
    },

    hideRoundResult(): void {
      roundResultOverlay.classList.add("hidden");
    },

    showResults(state, localSessionId): void {
      gameScreen.classList.add("hidden");
      resultsScreen.classList.remove("hidden");
      const snapshot = lobbySnapshot(state, localSessionId);
      renderLeaderboard(state);
      playAgainButton.disabled = !snapshot.isHost;
      playAgainButton.textContent = snapshot.isHost ? "Play again" : "Waiting for the host…";
      updateDataAttributes(state, localSessionId);
    },

    hideResults(): void {
      resultsScreen.classList.add("hidden");
    },

    prefillJoin(code, error): void {
      gameScreen.classList.add("hidden");
      lobbyScreen.classList.add("hidden");
      resultsScreen.classList.add("hidden");
      homeScreen.classList.remove("hidden");
      codeInput.value = code;
      homeHint.textContent = `Enter your name to join room ${code}`;
      homeHint.classList.remove("hidden");
      homeError.classList.add("hidden");
      if (error) {
        showError(error);
      }
    },

    getSavedName(): string {
      return localStorage.getItem(STORAGE_KEY) ?? "";
    },
  };

  function renderLobby(state: FlappyRaceClientState, localSessionId: string): void {
    lobbyCode.textContent = state.roomCode;
    const inviteUrl = buildInviteUrl(state.roomCode, window.location.href);
    inviteUrlInput.value = inviteUrl;
    if (renderedInviteCode !== state.roomCode) {
      renderedInviteCode = state.roomCode;
      void renderQrCode(inviteQr, inviteUrl).catch(() => {
        // QR rendering is best-effort; the invite link remains available.
      });
    }
    const players = [...state.players.entries()]
      .map(([sessionId, player]) => ({ sessionId, ...player }))
      .sort((a, b) => a.joinedOrder - b.joinedOrder);
    playerList.replaceChildren(
      ...players.map((player) => {
        const row = document.createElement("li");
        row.className = "player-row";
        if (player.connectionStatus !== "connected") {
          row.classList.add("reconnecting");
        }
        const color = document.createElement("span");
        color.className = "player-color";
        color.style.background = player.color || "#ffffff";
        const name = document.createElement("span");
        name.className = "player-name";
        name.textContent = player.name;
        row.append(color, name);
        if (player.isHost) {
          row.append(badge("host", "host"));
        }
        if (player.sessionId === localSessionId) {
          row.append(badge("you", "you"));
        }
        return row;
      }),
    );
    const snapshot = lobbySnapshot(state, localSessionId);
    startButton.classList.toggle("hidden", !snapshot.isHost);
    waitingMessage.classList.toggle("hidden", snapshot.isHost);
    startButton.disabled = !snapshot.canStart;
    startButton.textContent = snapshot.canStart
      ? "Start match"
      : `Waiting for ${Math.max(0, snapshot.minPlayers - snapshot.players.length)} more player(s)`;
  }

  function renderLegend(state: FlappyRaceClientState): void {
    const players = [...state.players.values()]
      .filter((player) => player.roundActive || player.eliminated || !player.matchRemoved)
      .sort((a, b) => a.joinedOrder - b.joinedOrder);
    countdownLegend.replaceChildren(
      ...players.map((player) => {
        const row = document.createElement("div");
        row.className = "legend-row";
        const chip = document.createElement("span");
        chip.className = "legend-chip";
        chip.style.background = player.color || "#ffffff";
        const name = document.createElement("span");
        name.className = "legend-name";
        name.textContent = player.name;
        row.append(chip, name);
        return row;
      }),
    );
  }

  function renderScores(state: FlappyRaceClientState): void {
    const players = [...state.players.values()].sort((a, b) => a.joinedOrder - b.joinedOrder);
    roundResultScores.replaceChildren(
      ...players.map((player) => {
        const row = document.createElement("div");
        row.className = "score-row";
        const chip = document.createElement("span");
        chip.className = "legend-chip";
        chip.style.background = player.color || "#ffffff";
        const name = document.createElement("span");
        name.textContent = player.name;
        const score = document.createElement("span");
        score.className = "score-value";
        score.textContent = `${player.roundWins} win${player.roundWins === 1 ? "" : "s"}`;
        row.append(chip, name, score);
        return row;
      }),
    );
  }

  function renderLeaderboard(state: FlappyRaceClientState): void {
    if (!state.result) {
      return;
    }
    leaderboard.replaceChildren(
      ...state.result.leaderboard.map((entry) => {
        const player = state.players.get(entry.sessionId);
        const row = document.createElement("li");
        row.className = "score-row leaderboard-row";
        const rank = document.createElement("span");
        rank.className = "leaderboard-rank";
        rank.textContent = `#${entry.rank}`;
        const chip = document.createElement("span");
        chip.className = "legend-chip";
        chip.style.background = player?.color || "#ffffff";
        const label = document.createElement("span");
        label.textContent = entry.label;
        const score = document.createElement("span");
        score.className = "score-value";
        score.dataset.score = String(entry.primaryScore);
        score.textContent = `${entry.primaryScore} win${entry.primaryScore === 1 ? "" : "s"}`;
        row.append(rank, chip, label, score);
        return row;
      }),
    );
  }

  function updateDataAttributes(state: FlappyRaceClientState, localSessionId: string): void {
    const local = state.players.get(localSessionId);
    const playersSummary = [...state.players.entries()].map(([sessionId, player]) => ({
      sessionId,
      name: player.name,
      color: player.color,
      roundWins: player.roundWins,
      clearedObstacleCount: player.clearedObstacleCount,
      roundActive: player.roundActive,
      eliminated: player.eliminated,
      matchRemoved: player.matchRemoved,
      birdY: player.birdY,
    }));
    app.dataset.phase = state.phase;
    app.dataset.status = state.status;
    app.dataset.round = String(state.roundNumber);
    app.dataset.courseSeed = state.courseSeed;
    app.dataset.courseSpeed = String(state.courseSpeed);
    app.dataset.elapsed = String(state.courseElapsedMs);
    app.dataset.openings = JSON.stringify(state.obstacleOpenings);
    app.dataset.roundWinners = JSON.stringify(state.roundWinnerSessionIds);
    app.dataset.players = JSON.stringify(playersSummary);
    app.dataset.localY = String(local?.birdY ?? "");
    app.dataset.localActive = String(local?.roundActive ?? false);
    app.dataset.spectating = String(
      (state.phase === "countdown" || state.phase === "running") &&
        (!local?.roundActive || local.matchRemoved),
    );
    app.dataset.birdSize = `${FLAPPY_RACE_CONFIG.birdWidth}x${FLAPPY_RACE_CONFIG.birdHeight}`;
    app.dataset.sessionId = localSessionId;
    app.dataset.resultWinners = JSON.stringify(state.result?.winnerSessionIds ?? []);
    app.dataset.resultLeaderboard = JSON.stringify(
      state.result?.leaderboard.map((entry) => ({
        sessionId: entry.sessionId,
        rank: entry.rank,
        primaryScore: entry.primaryScore,
        label: entry.label,
      })) ?? [],
    );
  }

  function badge(kind: "host" | "you", text: string): HTMLSpanElement {
    const element = document.createElement("span");
    element.className = `badge ${kind}`;
    element.textContent = text;
    return element;
  }

  function lobbySnapshot(
    state: FlappyRaceClientState,
    localSessionId: string,
  ): {
    roomCode: string;
    isHost: boolean;
    canStart: boolean;
    minPlayers: number;
    players: Array<{ sessionId: string; connectionStatus: string; isReady: boolean }>;
  } {
    const players = [...state.players.entries()].map(([sessionId, player]) => ({
      sessionId,
      connectionStatus: player.connectionStatus,
      isReady: player.isReady,
      joinedOrder: player.joinedOrder,
    }));
    const isHost = state.hostSessionId === localSessionId;
    return {
      roomCode: state.roomCode,
      isHost,
      canStart:
        state.status === "lobby" &&
        isHost &&
        players.filter((player) => player.connectionStatus === "connected").length >=
          state.minPlayers,
      minPlayers: state.minPlayers,
      players,
    };
  }
}

function getElement<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element #${id}`);
  }
  return element as T;
}
