import "./styles.css";

interface GameInfo {
  id: string;
  minPlayers: number;
  maxPlayers: number;
  requiresReady: boolean;
  allowJoinAfterStart: boolean;
}

interface GamesResponse {
  games: GameInfo[];
}

const NAME_STORAGE_KEY = "multiplayer:name";

const GAME_META: Record<string, { title: string; blurb: string }> = {
  falling_platforms: {
    title: "Falling Platforms",
    blurb: "Swipe to hop across a shrinking grid. Last one standing wins.",
  },
  tap_race: {
    title: "Tap Race",
    blurb: "Tap as fast as you can when the match starts. Most taps wins.",
  },
  capital_pin: {
    title: "Capital Pin",
    blurb: "Drop your pin where you think each capital city is. Closest wins.",
  },
  flappy_race: {
    title: "Flappy Race",
    blurb: "Tap to flap through shared obstacle courses. Furthest bird wins each round.",
  },
};

/**
 * The game server URL. In dev the hub runs on its own Vite port (5176) while the
 * Colyseus server runs on 2567; in production everything shares one origin.
 */
function serverBaseUrl(): string {
  const env = import.meta.env.VITE_GAME_SERVER_URL;
  if (typeof env === "string" && env.trim() !== "") return env.trim().replace(/\/$/, "");
  if (window.location.port === "5176") {
    return `${window.location.protocol}//${window.location.hostname}:2567`;
  }
  return `${window.location.protocol}//${window.location.host}`;
}

/**
 * Where a game's client lives. In dev each client is its own Vite server on a
 * fixed port; in production the single server serves each at a path prefix.
 */
function gameClientBase(gameId: string): string {
  const devPorts: Record<string, number> = {
    falling_platforms: 5173,
    tap_race: 5174,
    capital_pin: 5175,
    flappy_race: 5177,
  };
  const prodPaths: Record<string, string> = {
    falling_platforms: "/falling-platforms/",
    tap_race: "/tap-race/",
    capital_pin: "/capital-pin/",
    flappy_race: "/flappy-race/",
  };
  if (window.location.port === "5176") {
    const port = devPorts[gameId];
    if (port) return `${window.location.protocol}//${window.location.hostname}:${port}/`;
  }
  return prodPaths[gameId] ?? "#";
}

/** Build a hand-off URL carrying the name (and code, when joining). */
function handOffUrl(gameId: string, name: string, code: string | null): string {
  const base = gameClientBase(gameId);
  const params = new URLSearchParams({ name });
  if (code) params.set("code", code);
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${params.toString()}`;
}

async function loadGames(): Promise<GameInfo[]> {
  try {
    const response = await fetch(`${serverBaseUrl()}/games`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = (await response.json()) as GamesResponse;
    return data.games;
  } catch {
    return [];
  }
}

type Mode = "create" | "join";

interface LauncherState {
  games: GameInfo[];
  selectedGameId: string;
  mode: Mode;
  name: string;
  code: string;
  error: string | null;
}

const state: LauncherState = {
  games: [],
  selectedGameId: "",
  mode: "create",
  name: localStorage.getItem(NAME_STORAGE_KEY) ?? "",
  code: new URLSearchParams(window.location.search).get("code")?.toUpperCase() ?? "",
  error: null,
};

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("#root element not found");
}
const root = rootElement;

function render(): void {
  if (state.games.length === 0) {
    root.innerHTML = `
      <main class="hub">
        <h1>Multiplayer Games</h1>
        <p class="muted">The game server is not reachable. Start it with <code>pnpm dev</code>.</p>
      </main>`;
    return;
  }
  const firstGame = state.games[0];
  if (!firstGame) {
    return;
  }
  if (!state.selectedGameId) {
    state.selectedGameId = firstGame.id;
  }
  const selected = state.games.find((g) => g.id === state.selectedGameId) ?? firstGame;

  const gameTabs = state.games
    .map((game) => {
      const meta = GAME_META[game.id];
      const active = game.id === state.selectedGameId ? " active" : "";
      return `<button class="game-tab${active}" data-game="${game.id}" type="button">
        <span class="tab-title">${meta?.title ?? game.id}</span>
        <span class="tab-blurb">${meta?.blurb ?? ""}</span>
        <span class="tab-meta">${game.minPlayers}–${game.maxPlayers} players</span>
      </button>`;
    })
    .join("");

  const createActive = state.mode === "create" ? " active" : "";
  const joinActive = state.mode === "join" ? " active" : "";

  root.innerHTML = `
    <main class="hub">
      <h1>Multiplayer Games</h1>
      <p class="muted">Pick a game, then create a room or join with a code. You'll be sent straight into the game.</p>
      <div class="grid">${gameTabs}</div>

      <section class="launcher">
        <div class="mode-switch">
          <button class="mode-tab${createActive}" data-mode="create" type="button">Create room</button>
          <button class="mode-tab${joinActive}" data-mode="join" type="button">Join room</button>
        </div>

        <label class="field-label" for="name-input">Your name</label>
        <input id="name-input" class="field" type="text" autocomplete="off" maxlength="20"
          placeholder="Display name" value="${escapeHtml(state.name)}" />

        <div class="join-fields${joinActive}">
          <label class="field-label" for="code-input">Room code</label>
          <input id="code-input" class="field" type="text" autocapitalize="characters"
            maxlength="6" placeholder="ABCDE" value="${escapeHtml(state.code)}" />
        </div>

        <button id="go-button" class="button primary" type="button">
          ${state.mode === "create" ? "Create room & play" : "Join room & play"}
        </button>
        ${state.error ? `<p class="error" role="alert">${escapeHtml(state.error)}</p>` : ""}
        <p class="muted small">Playing: ${GAME_META[selected.id]?.title ?? selected.id} · ${selected.minPlayers}–${selected.maxPlayers} players</p>
      </section>
    </main>`;

  wireEvents();
}

function wireEvents(): void {
  for (const btn of root.querySelectorAll<HTMLButtonElement>(".game-tab")) {
    btn.addEventListener("click", () => {
      const gameId = btn.dataset.game;
      if (!gameId) {
        return;
      }
      state.selectedGameId = gameId;
      render();
    });
  }
  for (const btn of root.querySelectorAll<HTMLButtonElement>(".mode-tab")) {
    btn.addEventListener("click", () => {
      state.mode = btn.dataset.mode as Mode;
      render();
    });
  }
  root.querySelector<HTMLInputElement>("#name-input")?.addEventListener("input", (e) => {
    state.name = (e.target as HTMLInputElement).value;
  });
  root.querySelector<HTMLInputElement>("#code-input")?.addEventListener("input", (e) => {
    state.code = (e.target as HTMLInputElement).value.toUpperCase();
  });
  root.querySelector<HTMLButtonElement>("#go-button")?.addEventListener("click", go);
}

function go(): void {
  const name = state.name.trim();
  if (!name) {
    state.error = "Enter a display name first";
    render();
    return;
  }
  localStorage.setItem(NAME_STORAGE_KEY, name);

  if (state.mode === "join") {
    const code = state.code.trim();
    if (!code) {
      state.error = "Enter a room code";
      render();
      return;
    }
    window.location.href = handOffUrl(state.selectedGameId, name, code);
    return;
  }
  // Create: hand off with just the name; the game client creates the room.
  window.location.href = handOffUrl(state.selectedGameId, name, null);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}

void loadGames().then((games) => {
  state.games = games;
  render();
});
