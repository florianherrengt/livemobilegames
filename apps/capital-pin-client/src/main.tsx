import type { CapitalPinClientState, CapitalPinCommand } from "@falling-platforms/capital-pin";
import { formatDistanceKm } from "@falling-platforms/capital-pin";
import { buildInviteUrl, MultiplayerClient, renderQrCode } from "@falling-platforms/client-sdk";
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { GameMap, type LngLat, useMap } from "./components/GameMap.js";
import { MapMarker } from "./components/MapMarker.js";
import { computeResultsCamera, type Point } from "./map/bounds.js";
import { getPlayerColour } from "./map/markers.js";
import "./styles.css";

const NAME_STORAGE_KEY = "capital-pin:name";
const GAME_ID = "capital_pin";

function defaultServerUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  if (window.location.port === "5175") {
    return `${protocol}//${window.location.hostname}:2567`;
  }
  return `${protocol}//${window.location.host}`;
}

const serverUrl =
  (import.meta.env.VITE_GAME_SERVER_URL as string | undefined) || defaultServerUrl();

type Screen = "home" | "lobby" | "round" | "results" | "finished";

function App() {
  const client = useMemo(
    () =>
      new MultiplayerClient<CapitalPinClientState, CapitalPinCommand>({
        serverUrl,
        storageKey: "capital-pin:connection",
      }),
    [],
  );
  const [status, setStatus] = useState(client.getConnectionStatus());
  const [state, setState] = useState<CapitalPinClientState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joinHint, setJoinHint] = useState<string | null>(null);
  const [name, setName] = useState(localStorage.getItem(NAME_STORAGE_KEY) ?? "");
  const [code, setCode] = useState(
    () => new URLSearchParams(window.location.search).get("code")?.toUpperCase() ?? "",
  );

  useEffect(() => {
    const offConn = client.onConnectionChange(setStatus);
    // Colyseus patches mutate the state object in place, so React needs a new
    // reference on every change or it bails out of re-rendering.
    const offState = client.onStateChange(() => {
      const next = client.getState();
      setState(next ? { ...next } : null);
    });
    const offErr = client.onError((payload) => setError(payload.error.message));
    return () => {
      offConn();
      offState();
      offErr();
    };
  }, [client]);

  // Periodically sync server time for countdowns and force a re-render.
  useEffect(() => {
    const id = window.setInterval(() => {
      client.syncTime();
      const next = client.getState();
      setState(next ? { ...next } : null);
    }, 1000);
    return () => window.clearInterval(id);
  }, [client]);

  // Auto-connect when handed off from the launcher via ?name=&code=. Invite
  // links (?code= without ?name=) join with the saved name when one exists,
  // otherwise pre-fill the code and let the visitor enter a name.
  // biome-ignore lint/correctness/useExhaustiveDependencies: handoff runs once on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const handOffName = params.get("name");
    const handOffCode = params.get("code")?.toUpperCase() ?? "";
    if (client.getConnectionStatus() !== "idle") return;
    if (handOffCode) setCode(handOffCode);
    if (handOffName) {
      setName(handOffName);
      setCode(handOffCode);
      persistName(handOffName);
      if (handOffCode) {
        client
          .joinRoom({ roomCode: handOffCode, name: handOffName })
          .catch((e: unknown) => setError(messageOf(e)));
      } else {
        client
          .createRoom({ gameId: GAME_ID, name: handOffName })
          .catch((e: unknown) => setError(messageOf(e)));
      }
      return;
    }
    if (handOffCode) {
      if (name) {
        client.joinRoom({ roomCode: handOffCode, name }).catch((e: unknown) => {
          setError(messageOf(e));
          setJoinHint(`Enter your name to join room ${handOffCode}`);
        });
      } else {
        setJoinHint(`Enter your name to join room ${handOffCode}`);
      }
    }
    // Only on first load.
  }, []);

  const screen: Screen = deriveScreen(state, status);
  const selfSessionId = client.getMembership()?.sessionId ?? "";

  return (
    <div className="app" data-screen={screen}>
      {status === "reconnecting" && <div className="overlay">Reconnecting…</div>}
      {screen === "home" && (
        <Home
          name={name}
          code={code}
          error={error}
          hint={joinHint}
          onName={setName}
          onCode={setCode}
          onCreate={() => {
            setError(null);
            setJoinHint(null);
            if (!persistName(name)) return;
            client
              .createRoom({ gameId: GAME_ID, name })
              .catch((e: unknown) => setError(messageOf(e)));
          }}
          onJoin={() => {
            setError(null);
            setJoinHint(null);
            if (!persistName(name)) return;
            if (!code) {
              setError("Enter a room code");
              return;
            }
            client.joinRoom({ roomCode: code, name }).catch((e: unknown) => setError(messageOf(e)));
          }}
        />
      )}
      {screen === "lobby" && (
        <Lobby
          client={client}
          state={state}
          selfSessionId={selfSessionId}
          onLeave={() => {
            void client.leave();
            setState(null);
          }}
        />
      )}
      {screen === "round" && state && (
        <Round client={client} state={state} selfSessionId={selfSessionId} />
      )}
      {screen === "results" && state && <Results state={state} />}
      {screen === "finished" && state && (
        <Finished client={client} state={state} selfSessionId={selfSessionId} />
      )}
    </div>
  );
}

function deriveScreen(state: CapitalPinClientState | null, status: string): Screen {
  if (status === "disconnected" && !state) return "home";
  if (!state) return "home";
  if (state.status === "lobby") return "lobby";
  if (state.phase === "finished" || state.status === "finished") return "finished";
  if (state.phase === "round-results") return "results";
  return "round";
}

// --- Home ---

function Home(props: {
  name: string;
  code: string;
  error: string | null;
  hint: string | null;
  onName: (v: string) => void;
  onCode: (v: string) => void;
  onCreate: () => void;
  onJoin: () => void;
}) {
  return (
    <section className="screen">
      <h1>Capital Pin</h1>
      <p>Drop your pin where you think each capital city is. Closest guess wins the round.</p>
      <label className="field-label" htmlFor="name-input">
        Your name
      </label>
      <input
        id="name-input"
        className="field"
        type="text"
        autoComplete="off"
        maxLength={20}
        placeholder="Display name"
        value={props.name}
        onChange={(e) => props.onName(e.target.value)}
      />
      <button className="button primary" type="button" onClick={props.onCreate}>
        Create room
      </button>
      <div className="divider">or</div>
      <label className="field-label" htmlFor="code-input">
        Room code
      </label>
      <input
        id="code-input"
        className="field"
        type="text"
        autoCapitalize="characters"
        maxLength={6}
        placeholder="ABCDE"
        value={props.code}
        onChange={(e) => props.onCode(e.target.value.toUpperCase())}
      />
      <button className="button" type="button" onClick={props.onJoin}>
        Join room
      </button>
      {props.error && (
        <p className="error" role="alert">
          {props.error}
        </p>
      )}
      {props.hint && <p className="hint">{props.hint}</p>}
    </section>
  );
}

// --- Lobby ---

function Lobby(props: {
  client: MultiplayerClient<CapitalPinClientState, CapitalPinCommand>;
  state: CapitalPinClientState | null;
  selfSessionId: string;
  onLeave: () => void;
}) {
  const snapshot = props.client.getLobbySnapshot();
  const inviteUrl = snapshot ? buildInviteUrl(snapshot.roomCode, window.location.href) : "";
  const qrRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!qrRef.current || !inviteUrl) return;
    void renderQrCode(qrRef.current, inviteUrl).catch(() => {
      // QR rendering is best-effort; the invite link remains available.
    });
  }, [inviteUrl]);
  const isHost = snapshot?.isHost ?? false;
  const players = snapshot?.players ?? [];
  const canStart = snapshot?.canStart ?? false;

  return (
    <section className="screen">
      <h1>Capital Pin</h1>
      <div className="code-row">
        <span className="code-label">Room</span>
        <span className="code">{snapshot?.roomCode ?? ""}</span>
        <button
          className="button"
          type="button"
          onClick={() =>
            void navigator.clipboard?.writeText(snapshot?.roomCode ?? "").catch(() => {})
          }
        >
          Copy
        </button>
      </div>
      <div className="invite-panel">
        <div className="invite-row">
          <input
            className="invite-url"
            type="text"
            readOnly
            aria-label="Invite link"
            value={inviteUrl}
          />
          <button
            className="button"
            type="button"
            onClick={() =>
              void navigator.clipboard?.writeText(inviteUrl).catch(() => {
                // The link stays visible on screen when the clipboard is unavailable.
              })
            }
          >
            Copy link
          </button>
        </div>
        <div ref={qrRef} className="invite-qr" />
      </div>
      <h2>Players</h2>
      <ul className="player-list">
        {players.map((player) => (
          <li
            key={player.sessionId}
            className={`player-row${player.connectionStatus !== "connected" ? " reconnecting" : ""}`}
          >
            <span className="player-name">{player.name}</span>
            {player.isHost && <span className="badge host">host</span>}
            {player.sessionId === props.selfSessionId && <span className="badge you">you</span>}
          </li>
        ))}
      </ul>
      <button
        className="button primary"
        type="button"
        disabled={!canStart}
        onClick={() => props.client.startGame().catch((e: unknown) => console.error(e))}
      >
        {isHost ? (canStart ? "Start game" : "Waiting for more players…") : "Waiting for the host…"}
      </button>
      <button className="button leave" type="button" onClick={props.onLeave}>
        Leave room
      </button>
    </section>
  );
}

// --- Round (active guess phase) ---

export function Round(props: {
  client: MultiplayerClient<CapitalPinClientState, CapitalPinCommand>;
  state: CapitalPinClientState;
  selfSessionId: string;
}) {
  const { state, client, selfSessionId } = props;
  const [guess, setGuess] = useState<LngLat | null>(null);
  // Reset the local guess whenever a new round begins.
  const roundRef = useRef(state.roundNumber);
  if (roundRef.current !== state.roundNumber) {
    roundRef.current = state.roundNumber;
    setGuess(null);
  }

  const self = state.players.get(selfSessionId);
  const locked = self?.submitted ?? false;
  const serverNow = client.getEstimatedServerTime() ?? Date.now();
  const secondsLeft = Math.max(0, Math.ceil((state.roundEndsAt - serverNow) / 1000));

  const submit = () => {
    if (!guess) return;
    client.sendGameCommand({
      type: "submit",
      roundNumber: state.roundNumber,
      latitude: guess.lat,
      longitude: guess.lng,
    });
  };

  return (
    <section className="screen map-screen">
      <header className="round-header">
        <span>
          Round {state.roundNumber} / {state.totalRounds}
        </span>
        <span className="capital">{state.currentCapitalName}</span>
        <span className="timer">{secondsLeft}s</span>
      </header>
      <GameMap onMapClick={setGuess} interactive={!locked}>
        {guess && <MapMarker longitude={guess.lng} latitude={guess.lat} colour="#4363d8" />}
        <SubmittedList players={[...state.players.values()]} />
      </GameMap>
      <div className="round-actions">
        {locked ? (
          <button className="button" type="button" disabled>
            Answer locked
          </button>
        ) : (
          <button className="button primary" type="button" disabled={!guess} onClick={submit}>
            Lock answer
          </button>
        )}
      </div>
    </section>
  );
}

/** Lightweight indicator that a player has locked (no reveal of their guess). */
function SubmittedList({ players }: { players: Array<{ name: string; submitted: boolean }> }) {
  return (
    <div className="submitted-list">
      {players
        .filter((p) => p.submitted)
        .map((p) => (
          <span key={p.name} className="submitted-chip">
            ✓ {p.name}
          </span>
        ))}
    </div>
  );
}

// --- Results (round-results phase) ---

export function Results({ state }: { state: CapitalPinClientState }) {
  const result = state.lastResult;
  const points: Point[] = useMemo(() => {
    if (!result) return [];
    return [
      { latitude: result.correctLatitude, longitude: result.correctLongitude },
      ...result.guesses.map((g) => ({ latitude: g.latitude, longitude: g.longitude })),
    ];
  }, [result]);

  return (
    <section className="screen map-screen">
      <GameMap interactive={false}>
        <ResultsMap result={result} points={points} />
      </GameMap>
      <div className="results-panel">
        <h2>
          Round {result?.roundNumber ?? ""}: {result?.capitalName ?? ""}
        </h2>
        <ul className="standings">
          {(result?.guesses ?? [])
            .slice()
            .sort((a, b) => a.distanceKm - b.distanceKm)
            .map((g) => (
              <li key={g.sessionId} className={`standing${g.isWinner ? " winner" : ""}`}>
                <span
                  className="dot"
                  style={{ background: getPlayerColour(g.sessionId) }}
                  aria-hidden
                />
                <span className="name">{g.displayName}</span>
                <span className="distance">{formatDistanceKm(g.distanceKm)}</span>
                {g.isWinner && <span className="badge host">winner</span>}
              </li>
            ))}
        </ul>
      </div>
    </section>
  );
}

function ResultsMap({
  result,
  points,
}: {
  result: CapitalPinClientState["lastResult"];
  points: Point[];
}) {
  const map = useMap();
  useEffect(() => {
    if (!map || points.length === 0) return;
    const isMobile = window.innerWidth < 640;
    const camera = computeResultsCamera(points, isMobile);
    if (camera.kind === "fitBounds") {
      map.fitBounds(camera.bounds, { padding: camera.padding, maxZoom: camera.maxZoom });
    } else {
      map.setCenter(camera.center);
      map.setZoom(camera.zoom);
    }
  }, [map, points]);

  if (!map || !result) return null;
  return (
    <>
      <MapMarker
        longitude={result.correctLongitude}
        latitude={result.correctLatitude}
        label="★"
        colour="#111"
      />
      {result.guesses.map((g) => (
        <MapMarker
          key={g.sessionId}
          longitude={g.longitude}
          latitude={g.latitude}
          label={g.displayName.slice(0, 1)}
          colour={getPlayerColour(g.sessionId)}
        />
      ))}
    </>
  );
}

// --- Finished ---

function Finished(props: {
  client: MultiplayerClient<CapitalPinClientState, CapitalPinCommand>;
  state: CapitalPinClientState;
  selfSessionId: string;
}) {
  const snapshot = props.client.getLobbySnapshot();
  const isHost = snapshot?.isHost ?? false;
  const result = props.state.result;
  const leaderboard = result?.leaderboard ?? [];
  return (
    <section className="screen">
      <h1>Game over</h1>
      <h2>Final standings</h2>
      <ol className="leaderboard">
        {leaderboard.map((entry) => (
          <li
            key={entry.sessionId}
            className={`rank-row${entry.sessionId === props.selfSessionId ? " self" : ""}`}
          >
            <span className="rank">#{entry.rank}</span>
            <span className="name">{entry.label}</span>
            <span className="score">{entry.primaryScore} wins</span>
          </li>
        ))}
      </ol>
      <button
        className="button primary"
        type="button"
        disabled={!isHost}
        onClick={() => props.client.playAgain().catch((e: unknown) => console.error(e))}
      >
        {isHost ? "Play again" : "Waiting for the host…"}
      </button>
      <button
        className="button leave"
        type="button"
        onClick={() => {
          void props.client.leave();
        }}
      >
        Leave room
      </button>
    </section>
  );
}

// --- helpers ---

function persistName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed) {
    localStorage.setItem(NAME_STORAGE_KEY, trimmed);
    return true;
  }
  return false;
}

function messageOf(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return "Could not reach the game server";
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
