import {
  Alert,
  Box,
  Button,
  Chip,
  List,
  ListItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  LIVE_DRAWING_GUESSING_CONSTANTS,
  LIVE_DRAWING_GUESSING_MESSAGE_TYPES,
  type LiveDrawingDrawerBriefing,
  type LiveDrawingGuessingState,
  type LiveDrawingPlayerState,
  liveDrawingDrawerBriefingSchema,
  liveDrawingGuessFeedbackSchema,
  ROOM_MESSAGE_TYPES,
  roomErrorPayloadSchema,
} from "@phone-party/protocol";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { HowToPlay } from "../../components/how-to-play.js";
import { InvitePanel } from "../../components/invite-panel.js";
import { gameFeedback, hapticFeedback, primeGameFeedback } from "../../feedback.js";
import type { RoomConnection } from "../../game-connection.js";
import { DrawingCanvas, type StrokeBatch } from "./drawing-canvas.js";

export function LiveDrawingGuessingGameView({
  connection,
  state,
  selfSessionId,
}: {
  connection: RoomConnection;
  state: LiveDrawingGuessingState;
  selfSessionId: string;
}) {
  const [roomError, setRoomError] = useState<string | null>(null);
  const [drawerBriefing, setDrawerBriefing] = useState<LiveDrawingDrawerBriefing | null>(null);
  const [guessFeedback, setGuessFeedback] = useState<string | null>(null);
  const phaseRef = useRef(state.phase);
  const feedbackTimerRef = useRef<number | null>(null);

  if (phaseRef.current !== state.phase) {
    phaseRef.current = state.phase;
    setRoomError(null);
  }

  useEffect(() => {
    const off = connection.room.onMessage(ROOM_MESSAGE_TYPES.error, (payload) => {
      const parsed = roomErrorPayloadSchema.safeParse(payload);
      if (parsed.success) {
        setRoomError(parsed.data.message);
      }
    });
    return off;
  }, [connection.room]);

  useEffect(() => {
    const off = connection.room.onMessage(
      LIVE_DRAWING_GUESSING_MESSAGE_TYPES.drawerBriefing,
      (payload) => {
        const parsed = liveDrawingDrawerBriefingSchema.safeParse(payload);
        if (parsed.success) {
          setDrawerBriefing(parsed.data);
        }
      },
    );
    return off;
  }, [connection.room]);

  useEffect(() => {
    const off = connection.room.onMessage(
      LIVE_DRAWING_GUESSING_MESSAGE_TYPES.guessFeedback,
      (payload) => {
        const parsed = liveDrawingGuessFeedbackSchema.safeParse(payload);
        if (!parsed.success) {
          return;
        }
        const messages: Record<typeof parsed.data.kind, string> = {
          incorrect: "Incorrect",
          "not-active": "Guessing isn't active yet",
          "not-guesser": "Spectators can't guess",
          invalid: "Enter a valid guess",
        };
        gameFeedback("invalid");
        setGuessFeedback(messages[parsed.data.kind]);
        if (feedbackTimerRef.current !== null) {
          window.clearTimeout(feedbackTimerRef.current);
        }
        feedbackTimerRef.current = window.setTimeout(() => setGuessFeedback(null), 1_500);
      },
    );
    return () => {
      off();
      if (feedbackTimerRef.current !== null) {
        window.clearTimeout(feedbackTimerRef.current);
      }
    };
  }, [connection.room]);

  const self = selfPlayer(state, selfSessionId);
  const isSpectator = self?.isSpectator === true;
  const currentDrawerBriefing =
    drawerBriefing?.turnNumber === state.turnNumber &&
    drawerBriefing.roundNumber === state.roundNumber
      ? drawerBriefing
      : null;

  useEffect(() => {
    // The drawer's private word is sent at turn start; if this client mounted
    // late (transition, refresh, or reconnect), request it from the server.
    const isCurrentDrawer =
      self !== undefined &&
      self.playerId === state.drawerPlayerId &&
      (state.phase === "preparing" || state.phase === "drawing");
    if (isCurrentDrawer && currentDrawerBriefing === null) {
      connection.room.send(LIVE_DRAWING_GUESSING_MESSAGE_TYPES.drawerRequest, {});
    }
  }, [connection.room, currentDrawerBriefing, self, state.drawerPlayerId, state.phase]);

  if (state.phase === "preparing" || state.phase === "drawing") {
    return (
      <TurnView
        connection={connection}
        state={state}
        self={self}
        isSpectator={isSpectator}
        drawerBriefing={currentDrawerBriefing}
        guessFeedback={guessFeedback}
        clearGuessFeedback={() => setGuessFeedback(null)}
        roomError={roomError}
      />
    );
  }
  if (state.phase === "result") {
    return <ResultView connection={connection} state={state} />;
  }
  if (state.phase === "round-summary") {
    return <RoundSummaryView state={state} />;
  }
  if (state.phase === "finished") {
    return (
      <FinishedView
        connection={connection}
        state={state}
        selfSessionId={selfSessionId}
        roomError={roomError}
      />
    );
  }
  return <LobbyView connection={connection} state={state} roomError={roomError} />;
}

function TurnView({
  connection,
  state,
  self,
  isSpectator,
  drawerBriefing,
  guessFeedback,
  clearGuessFeedback,
  roomError,
}: {
  connection: RoomConnection;
  state: LiveDrawingGuessingState;
  self: LiveDrawingPlayerState | undefined;
  isSpectator: boolean;
  drawerBriefing: LiveDrawingDrawerBriefing | null;
  guessFeedback: string | null;
  clearGuessFeedback: () => void;
  roomError: string | null;
}) {
  const drawer = state.players.get(state.drawerPlayerId);
  const isDrawer = self?.playerId === state.drawerPlayerId && !isSpectator;
  const isGuesser = self !== undefined && !isDrawer && !isSpectator;
  const [paletteColor, setPaletteColor] = useState<string>(
    LIVE_DRAWING_GUESSING_CONSTANTS.PALETTE[0] ?? "#000000",
  );
  const now = useNow(100);
  const preparing = state.phase === "preparing";
  const secondsLeft = preparing
    ? Math.max(0, Math.ceil((state.prepareEndsAt - now) / 1000))
    : Math.max(0, Math.ceil((state.drawingEndsAt - now) / 1000));

  const sendStrokeBatch = (batch: StrokeBatch): void => {
    connection.room.send(LIVE_DRAWING_GUESSING_MESSAGE_TYPES.stroke, {
      type: "stroke",
      strokeId: batch.strokeId,
      color: batch.color,
      points: batch.points,
      complete: batch.complete,
    });
  };

  return (
    <Box
      component="main"
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        width: "100%",
        overflow: "hidden",
      }}
    >
      <Paper
        square
        component="header"
        sx={{
          p: 1.25,
          display: "flex",
          alignItems: "center",
          gap: 1,
          flexWrap: "wrap",
        }}
      >
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          Round {state.roundNumber}/{state.totalRounds} · Turn {state.turnNumber}/{state.totalTurns}
        </Typography>
        <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>
          {preparing ? `${secondsLeft}` : `${secondsLeft}s`}
        </Typography>
        {isSpectator && <Chip label="Spectating" size="small" variant="outlined" color="info" />}
        {(connection.reconnecting || self?.connectionStatus !== "connected") &&
          self !== undefined && (
            <Chip label="Reconnecting…" size="small" variant="outlined" color="warning" />
          )}
        <Button
          type="button"
          size="small"
          variant="text"
          sx={{ ml: "auto" }}
          onClick={() => connection.leave()}
        >
          Leave
        </Button>
      </Paper>

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          p: 1,
          gap: 1,
          overflow: "hidden",
        }}
      >
        {isDrawer && <DrawerInfo briefing={drawerBriefing} preparing={preparing} />}
        {isGuesser && <GuesserInfo state={state} preparing={preparing} drawer={drawer} />}
        {isSpectator && <SpectatorInfo state={state} preparing={preparing} drawer={drawer} />}

        <Box sx={{ flex: 1, minHeight: 0 }}>
          <DrawingCanvas
            strokes={[...state.strokes]}
            interactive={isDrawer && !preparing && !connection.reconnecting}
            ariaLabel={`Live drawing${isDrawer ? " — draw with one finger" : ""}`}
            testId="ldg-canvas"
            color={paletteColor}
            phase={state.phase}
            turnNumber={state.turnNumber}
            onStrokeBatch={sendStrokeBatch}
          />
        </Box>

        {state.phase === "preparing" && state.turnNumber === 1 && (
          <HowToPlay
            title="How to play Live Drawing & Guessing"
            points={
              isDrawer
                ? [
                    "Draw the word. Do not write letters or numbers.",
                    "Use one finger on the canvas; undo removes your last stroke.",
                    "If someone guesses first, you both score a point.",
                  ]
                : [
                    "Watch the drawing appear live.",
                    "Type the exact word before the timer ends.",
                    "First correct guess scores a point — so does the drawer.",
                  ]
            }
          />
        )}

        {roomError !== null && <Alert severity="error">{roomError}</Alert>}
      </Box>

      {isDrawer && !preparing && (
        <DrawerControls
          connection={connection}
          state={state}
          selectedColor={paletteColor}
          onSelectColor={setPaletteColor}
        />
      )}
      {isGuesser && !preparing && !connection.reconnecting && (
        <GuesserControls
          connection={connection}
          feedback={guessFeedback}
          onSent={clearGuessFeedback}
        />
      )}
      {preparing && (
        <Paper square sx={{ p: 1.25 }}>
          <Typography align="center" aria-live="polite" variant="body2">
            {isDrawer ? "Get ready to draw…" : `${drawer?.name ?? "The drawer"} is getting ready`}
          </Typography>
        </Paper>
      )}
    </Box>
  );
}

function DrawerInfo({
  briefing,
  preparing,
}: {
  briefing: LiveDrawingDrawerBriefing | null;
  preparing: boolean;
}) {
  return (
    <Paper sx={{ p: 1.25 }}>
      <Stack spacing={0.5}>
        <Typography variant="h2">You are drawing</Typography>
        <Typography
          variant="h1"
          sx={{ fontSize: "1.8rem", wordBreak: "break-word" }}
          data-testid="ldg-drawer-word"
          aria-live="polite"
        >
          {preparing ? (briefing?.word ?? "…") : (briefing?.word ?? "…")}
        </Typography>
        {briefing !== null && (
          <Typography color="text.secondary">Category: {briefing.category}</Typography>
        )}
        {preparing && (
          <Typography color="text.secondary">
            Draw the word. Do not write letters or numbers.
          </Typography>
        )}
      </Stack>
    </Paper>
  );
}

function GuesserInfo({
  state,
  preparing,
  drawer,
}: {
  state: LiveDrawingGuessingState;
  preparing: boolean;
  drawer: LiveDrawingPlayerState | undefined;
}) {
  return (
    <Paper sx={{ p: 1.25 }}>
      <Stack spacing={0.5}>
        <Typography variant="h2" data-testid="ldg-drawer-name">
          {drawer?.name ?? "Someone"} is drawing
        </Typography>
        {!preparing && (
          <>
            <Typography color="text.secondary">Category: {state.wordCategory}</Typography>
            <LetterPattern pattern={[...state.letterPattern]} />
          </>
        )}
        {preparing && (
          <Typography color="text.secondary">
            The category and word pattern appear when drawing starts.
          </Typography>
        )}
      </Stack>
    </Paper>
  );
}

function SpectatorInfo({
  state,
  preparing,
  drawer,
}: {
  state: LiveDrawingGuessingState;
  preparing: boolean;
  drawer: LiveDrawingPlayerState | undefined;
}) {
  return (
    <Paper sx={{ p: 1.25 }}>
      <Stack spacing={0.5}>
        <Typography variant="h2">Spectating</Typography>
        <Typography variant="body2">
          {preparing
            ? `${drawer?.name ?? "The drawer"} is getting ready`
            : `${drawer?.name ?? "The drawer"} is drawing`}
        </Typography>
        {!preparing && (
          <>
            <Typography color="text.secondary">Category: {state.wordCategory}</Typography>
            <LetterPattern pattern={[...state.letterPattern]} />
          </>
        )}
      </Stack>
    </Paper>
  );
}

function DrawerControls({
  connection,
  state,
  selectedColor,
  onSelectColor,
}: {
  connection: RoomConnection;
  state: LiveDrawingGuessingState;
  selectedColor: string;
  onSelectColor: (color: string) => void;
}) {
  const lastStroke = [...state.strokes].reverse().find((stroke) => stroke.complete);
  const canUndo = lastStroke !== undefined;
  return (
    <Paper square sx={{ p: 1.25 }}>
      <Stack spacing={1}>
        <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", alignItems: "center" }}>
          {LIVE_DRAWING_GUESSING_CONSTANTS.PALETTE.map((paletteColor) => (
            <ColorSwatch
              key={paletteColor}
              color={paletteColor}
              selected={selectedColor === paletteColor}
              onSelect={() => {
                hapticFeedback("select");
                onSelectColor(paletteColor);
              }}
            />
          ))}
        </Box>
        <Button
          type="button"
          variant="outlined"
          fullWidth
          disabled={!canUndo}
          onClick={() => {
            gameFeedback("select");
            connection.room.send(LIVE_DRAWING_GUESSING_MESSAGE_TYPES.undo, { type: "undo" });
          }}
          data-testid="ldg-undo"
        >
          Undo
        </Button>
      </Stack>
    </Paper>
  );
}

function ColorSwatch({
  color,
  selected,
  onSelect,
}: {
  color: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const names: Record<string, string> = {
    "#000000": "Black",
    "#e02424": "Red",
    "#1f6feb": "Blue",
    "#22a34a": "Green",
    "#f4c20d": "Yellow",
    "#ef7d1a": "Orange",
    "#8b3fb0": "Purple",
    "#6b4a2f": "Brown",
  };
  return (
    <Button
      type="button"
      aria-label={`${names[color] ?? "Colour"}${selected ? " (selected)" : ""}`}
      aria-pressed={selected}
      onClick={onSelect}
      sx={{
        minWidth: 44,
        width: 44,
        height: 44,
        p: 0,
        borderRadius: "50%",
        border: selected ? "3px solid" : "1px solid",
        borderColor: selected ? "primary.main" : "divider",
        bgcolor: color,
        "&:hover": { bgcolor: color },
      }}
    />
  );
}

function GuesserControls({
  connection,
  feedback,
  onSent,
}: {
  connection: RoomConnection;
  feedback: string | null;
  onSent: () => void;
}) {
  const [guess, setGuess] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const text = guess.trim();
    if (text === "") {
      return;
    }
    void primeGameFeedback();
    hapticFeedback("move");
    connection.room.send(LIVE_DRAWING_GUESSING_MESSAGE_TYPES.guess, {
      type: "guess",
      text,
    });
    setGuess("");
    onSent();
    inputRef.current?.focus();
  };

  return (
    <Paper square sx={{ p: 1.25 }}>
      <Box component="form" onSubmit={submit} noValidate>
        <Stack spacing={1}>
          <TextField
            id="ldg-guess"
            label="Your guess"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            inputRef={inputRef}
            value={guess}
            onChange={(event) => setGuess(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 80, "data-testid": "ldg-guess-input" } }}
          />
          <Button type="submit" fullWidth data-testid="ldg-guess-submit">
            Guess
          </Button>
          <Typography
            variant="body2"
            align="center"
            aria-live="polite"
            data-testid="ldg-guess-feedback"
          >
            {feedback ?? "Type the exact word and press Guess."}
          </Typography>
        </Stack>
      </Box>
    </Paper>
  );
}

function LetterPattern({ pattern }: { pattern: readonly string[] }) {
  const text = pattern.join("");
  return (
    <Typography
      component="div"
      aria-label={`Word pattern: ${text}`}
      data-testid="ldg-letter-pattern"
      sx={{
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: "1.4rem",
        fontWeight: 800,
        letterSpacing: "0.18em",
        lineHeight: 1.4,
        wordBreak: "break-all",
      }}
    >
      {pattern.join(" ")}
    </Typography>
  );
}

function ResultView({
  connection,
  state,
}: {
  connection: RoomConnection;
  state: LiveDrawingGuessingState;
}) {
  const result = state.lastResult;
  if (result === null) {
    return null;
  }
  const drawer = state.players.get(result.drawerPlayerId);
  const winner = state.players.get(result.winnerPlayerId);
  const solved = result.outcome === "solved";
  const headline =
    result.outcome === "solved"
      ? `${winner?.name ?? "Someone"} guessed it first`
      : result.outcome === "skipped"
        ? "Turn skipped — the drawer disconnected"
        : result.outcome === "no-guessers"
          ? "No guessers connected"
          : "Time is up";

  return (
    <Box
      component="main"
      sx={{ display: "flex", flexDirection: "column", height: "100dvh", width: "100%" }}
    >
      <Box sx={{ flex: 1, minHeight: 0, p: 1 }}>
        <DrawingCanvas
          strokes={[...state.strokes]}
          interactive={false}
          ariaLabel="The finished drawing"
          testId="ldg-canvas"
          color="#000000"
          phase={state.phase}
          turnNumber={state.turnNumber}
          onStrokeBatch={() => undefined}
        />
      </Box>
      <Box
        sx={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: "rgba(0, 0, 0, 0.62)",
          zIndex: 10,
          p: 3,
        }}
      >
        <Paper
          component="section"
          aria-labelledby="ldg-result-heading"
          sx={{ p: 3, textAlign: "center", maxWidth: 420, width: "100%" }}
        >
          <Typography component="h1" variant="h1" id="ldg-result-heading" aria-live="polite">
            {headline}
          </Typography>
          <Typography variant="h2" sx={{ mt: 1 }} color="text.secondary">
            The word was:
          </Typography>
          <Typography
            variant="h1"
            sx={{ fontSize: "2rem", wordBreak: "break-word" }}
            data-testid="ldg-result-word"
          >
            {result.word.toUpperCase()}
          </Typography>
          <Stack spacing={0.5} sx={{ mt: 2 }}>
            {solved ? (
              <>
                <Typography data-testid="ldg-result-winner">
                  {winner?.name ?? "The winner"} +1
                </Typography>
                <Typography>{drawer?.name ?? "The drawer"} +1</Typography>
              </>
            ) : (
              <Typography>No points awarded</Typography>
            )}
          </Stack>
          <Typography color="text.secondary" sx={{ mt: 2 }} aria-live="polite">
            Next turn starting…
          </Typography>
          <Button
            type="button"
            size="small"
            variant="text"
            sx={{ mt: 1 }}
            onClick={() => connection.leave()}
          >
            Leave room
          </Button>
        </Paper>
      </Box>
    </Box>
  );
}

function RoundSummaryView({ state }: { state: LiveDrawingGuessingState }) {
  const nextRound = state.roundNumber + 1;
  return (
    <Box
      component="main"
      sx={{
        height: "100dvh",
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        p: 3,
      }}
    >
      <Paper
        component="section"
        aria-labelledby="ldg-round-summary-heading"
        sx={{ p: 3, maxWidth: 420, width: "100%" }}
      >
        <Typography component="h1" variant="h1" id="ldg-round-summary-heading" align="center">
          Round {state.roundNumber} complete
        </Typography>
        <List disablePadding sx={{ mt: 2 }}>
          {[...state.players.values()]
            .filter((player) => !player.isSpectator)
            .sort((a, b) => b.score - a.score || a.joinedOrder - b.joinedOrder)
            .map((player) => (
              <ListItem key={player.playerId} disableGutters sx={{ gap: 1 }}>
                <Typography sx={{ flex: 1, fontWeight: 600 }}>{player.name}</Typography>
                <Typography sx={{ fontWeight: 800 }}>
                  {player.score} point{player.score === 1 ? "" : "s"}
                </Typography>
              </ListItem>
            ))}
        </List>
        <Typography align="center" color="text.secondary" sx={{ mt: 2 }} aria-live="polite">
          Round {nextRound} starting…
        </Typography>
      </Paper>
    </Box>
  );
}

function FinishedView({
  connection,
  state,
  selfSessionId,
  roomError,
}: {
  connection: RoomConnection;
  state: LiveDrawingGuessingState;
  selfSessionId: string;
  roomError: string | null;
}) {
  const result = state.result;
  const self = selfPlayer(state, selfSessionId);
  const isHost = state.hostSessionId === selfSessionId;
  const winnerNames = result
    ? result.winnerPlayerIds
        .map((playerId) => state.players.get(playerId)?.name)
        .filter((name): name is string => name !== undefined)
    : [];
  const headline = winnerNames.length === 1 ? `${winnerNames[0]} wins!` : "Joint winners";

  return (
    <Stack
      component="main"
      spacing={2}
      sx={{ p: { xs: 2, sm: 3 }, width: "100%", overflowY: "auto" }}
    >
      <Box component="header">
        <Typography component="h1" variant="h1">
          Final results
        </Typography>
        <Typography component="h2" variant="h2" aria-live="polite">
          {headline}
        </Typography>
      </Box>

      <Paper component="section" aria-labelledby="ldg-leaderboard-heading" sx={{ p: 2.25 }}>
        <Typography component="h2" variant="h2" id="ldg-leaderboard-heading">
          Scoreboard
        </Typography>
        <List disablePadding sx={{ mt: 1 }} data-testid="ldg-leaderboard">
          {result?.leaderboard.map((entry) => (
            <ListItem key={entry.playerId} disableGutters sx={{ gap: 1 }}>
              <Typography sx={{ minWidth: 32, fontWeight: 800 }}>#{entry.rank}</Typography>
              <Typography sx={{ flex: 1, fontWeight: 600 }}>{entry.label}</Typography>
              <Typography sx={{ fontWeight: 800 }}>
                {entry.score} point{entry.score === 1 ? "" : "s"}
              </Typography>
            </ListItem>
          ))}
        </List>
      </Paper>

      {self?.isSpectator === true && (
        <Alert severity="info">You joined as a spectator — you'll play in the next game.</Alert>
      )}
      {roomError !== null && <Alert severity="error">{roomError}</Alert>}

      {isHost ? (
        <Button
          type="button"
          fullWidth
          data-testid="ldg-play-again"
          onClick={() => connection.room.send(ROOM_MESSAGE_TYPES.playAgain, {})}
        >
          Play again
        </Button>
      ) : (
        <Paper sx={{ p: 2.25 }}>
          <Typography color="text.secondary" aria-live="polite">
            Waiting for the host to play again…
          </Typography>
        </Paper>
      )}

      <Button
        type="button"
        variant="outlined"
        color="error"
        fullWidth
        onClick={() => connection.leave()}
      >
        Leave room
      </Button>
    </Stack>
  );
}

function LobbyView({
  connection,
  state,
  roomError,
}: {
  connection: RoomConnection;
  state: LiveDrawingGuessingState;
  roomError: string | null;
}) {
  return (
    <Stack component="main" spacing={2} sx={{ p: { xs: 2, sm: 3 }, width: "100%" }}>
      <Box component="header">
        <Typography component="h1" variant="h1">
          Live Drawing &amp; Guessing
        </Typography>
        <Typography color="text.secondary">
          One player draws a secret word while everyone else guesses it live.
        </Typography>
      </Box>

      <Paper component="section" aria-labelledby="ldg-players-heading" sx={{ p: 2.25 }}>
        <Typography component="h2" variant="h2" id="ldg-players-heading">
          Players ({state.players.size})
        </Typography>
        <List disablePadding sx={{ mt: 1 }}>
          {[...state.players.values()]
            .sort((a, b) => a.joinedOrder - b.joinedOrder)
            .map((player) => (
              <ListItem key={player.playerId} disableGutters sx={{ gap: 1 }}>
                <Typography sx={{ flex: 1, fontWeight: 600 }}>{player.name}</Typography>
                {player.isHost && <Chip label="host" size="small" variant="outlined" />}
                {player.connectionStatus !== "connected" && (
                  <Chip label="reconnecting" size="small" color="warning" variant="outlined" />
                )}
              </ListItem>
            ))}
        </List>
      </Paper>

      <InvitePanel code={state.roomCode} />

      {roomError !== null && <Alert severity="error">{roomError}</Alert>}

      <Paper sx={{ p: 2.25 }}>
        <Typography color="text.secondary" aria-live="polite">
          Waiting for everyone to join, then the first turn starts automatically.
        </Typography>
      </Paper>

      <Button
        type="button"
        variant="outlined"
        color="error"
        fullWidth
        onClick={() => connection.leave()}
      >
        Leave room
      </Button>
    </Stack>
  );
}

function selfPlayer(
  state: LiveDrawingGuessingState,
  selfSessionId: string,
): LiveDrawingPlayerState | undefined {
  for (const player of state.players.values()) {
    if (player.sessionId === selfSessionId) {
      return player;
    }
  }
  return undefined;
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
