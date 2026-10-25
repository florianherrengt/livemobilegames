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
  type LiveDrawingLanguage,
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

type DrawingCopy = {
  incorrect: string;
  notActive: string;
  notGuesser: string;
  invalidGuess: string;
  roundTurn: (round: number, totalRounds: number, turn: number, totalTurns: number) => string;
  seconds: (seconds: number) => string;
  spectating: string;
  reconnecting: string;
  leave: string;
  canvas: string;
  canvasDrawing: string;
  howToPlay: string;
  drawerRules: string[];
  guesserRules: string[];
  readyToDraw: string;
  drawerReady: (name: string) => string;
  youAreDrawing: string;
  category: (category: string) => string;
  drawNoLetters: string;
  someone: string;
  personDrawing: (name: string) => string;
  categoryAndPatternWait: string;
  personReady: (name: string) => string;
  personIsDrawing: (name: string) => string;
  undo: string;
  selected: string;
  colorFallback: string;
  colors: Record<string, string>;
  yourGuess: string;
  guess: string;
  guessHint: string;
  wordPattern: (pattern: string) => string;
  someoneGuessedFirst: (name: string) => string;
  skipped: string;
  noGuessers: string;
  timeUp: string;
  finishedDrawing: string;
  wordWas: string;
  winner: string;
  drawer: string;
  noPoints: string;
  nextTurn: string;
  leaveRoom: string;
  roundComplete: (round: number) => string;
  points: (count: number) => string;
  roundStarting: (round: number) => string;
  wins: (name: string) => string;
  jointWinners: string;
  finalResults: string;
  scoreboard: string;
  spectatorNotice: string;
  playAgain: string;
  waitingHost: string;
  gameTitle: string;
  gameDescription: string;
  players: (count: number) => string;
  host: string;
  lobbyReconnecting: string;
  lobbyWaiting: string;
};

const DRAWING_COPY: Record<LiveDrawingLanguage, DrawingCopy> = {
  en: {
    incorrect: "Incorrect",
    notActive: "Guessing isn't active yet",
    notGuesser: "Spectators can't guess",
    invalidGuess: "Enter a valid guess",
    roundTurn: (round, totalRounds, turn, totalTurns) =>
      `Round ${round}/${totalRounds} · Turn ${turn}/${totalTurns}`,
    seconds: (seconds) => `${seconds}s`,
    spectating: "Spectating",
    reconnecting: "Reconnecting…",
    leave: "Leave",
    canvas: "Live drawing",
    canvasDrawing: "Live drawing — draw with one finger",
    howToPlay: "How to play Live Drawing & Guessing",
    drawerRules: [
      "Draw the word. Do not write letters or numbers.",
      "Use one finger on the canvas; undo removes your last stroke.",
      "If someone guesses first, you both score a point.",
    ],
    guesserRules: [
      "Watch the drawing appear live.",
      "Type the exact word before the timer ends.",
      "First correct guess scores a point — so does the drawer.",
    ],
    readyToDraw: "Get ready to draw…",
    drawerReady: (name) => `${name} is getting ready`,
    youAreDrawing: "You are drawing",
    category: (category) => `Category: ${category}`,
    drawNoLetters: "Draw the word. Do not write letters or numbers.",
    someone: "Someone",
    personDrawing: (name) => `${name} is drawing`,
    categoryAndPatternWait: "The category and word pattern appear when drawing starts.",
    personReady: (name) => `${name} is getting ready`,
    personIsDrawing: (name) => `${name} is drawing`,
    undo: "Undo",
    selected: " (selected)",
    colorFallback: "Colour",
    colors: {
      "#000000": "Black",
      "#e02424": "Red",
      "#1f6feb": "Blue",
      "#22a34a": "Green",
      "#f4c20d": "Yellow",
      "#ef7d1a": "Orange",
      "#8b3fb0": "Purple",
      "#6b4a2f": "Brown",
    },
    yourGuess: "Your guess",
    guess: "Guess",
    guessHint: "Type the exact word and press Guess.",
    wordPattern: (pattern) => `Word pattern: ${pattern}`,
    someoneGuessedFirst: (name) => `${name} guessed it first`,
    skipped: "Turn skipped — the drawer disconnected",
    noGuessers: "No guessers connected",
    timeUp: "Time is up",
    finishedDrawing: "The finished drawing",
    wordWas: "The word was:",
    winner: "The winner",
    drawer: "The drawer",
    noPoints: "No points awarded",
    nextTurn: "Next turn starting…",
    leaveRoom: "Leave room",
    roundComplete: (round) => `Round ${round} complete`,
    points: (count) => `${count} point${count === 1 ? "" : "s"}`,
    roundStarting: (round) => `Round ${round} starting…`,
    wins: (name) => `${name} wins!`,
    jointWinners: "Joint winners",
    finalResults: "Final results",
    scoreboard: "Scoreboard",
    spectatorNotice: "You joined as a spectator — you'll play in the next game.",
    playAgain: "Play again",
    waitingHost: "Waiting for the host to play again…",
    gameTitle: "Live Drawing & Guessing",
    gameDescription: "One player draws a secret word while everyone else guesses it live.",
    players: (count) => `Players (${count})`,
    host: "host",
    lobbyReconnecting: "reconnecting",
    lobbyWaiting: "Waiting for everyone to join, then the first turn starts automatically.",
  },
  fr: {
    incorrect: "Mauvaise réponse",
    notActive: "Les réponses ne sont pas encore ouvertes",
    notGuesser: "Les spectateurs ne peuvent pas proposer de réponse",
    invalidGuess: "Saisissez une réponse valide",
    roundTurn: (round, totalRounds, turn, totalTurns) =>
      `Manche ${round}/${totalRounds} · Tour ${turn}/${totalTurns}`,
    seconds: (seconds) => `${seconds} s`,
    spectating: "Spectateur",
    reconnecting: "Reconnexion…",
    leave: "Quitter",
    canvas: "Dessin en cours",
    canvasDrawing: "Dessin en cours — dessinez avec un doigt",
    howToPlay: "Comment jouer au dessin et devinettes",
    drawerRules: [
      "Dessinez le mot. N’écrivez ni lettres ni chiffres.",
      "Dessinez avec un doigt ; Annuler efface votre dernier trait.",
      "Si quelqu’un trouve le mot en premier, vous marquez tous les deux un point.",
    ],
    guesserRules: [
      "Regardez le dessin apparaître en direct.",
      "Saisissez le mot exact avant la fin du temps imparti.",
      "La première bonne réponse rapporte un point, tout comme au dessinateur.",
    ],
    readyToDraw: "Préparez-vous à dessiner…",
    drawerReady: (name) => `${name} se prépare`,
    youAreDrawing: "C’est à vous de dessiner",
    category: (category) => `Catégorie : ${category}`,
    drawNoLetters: "Dessinez le mot. N’écrivez ni lettres ni chiffres.",
    someone: "Quelqu’un",
    personDrawing: (name) => `${name} dessine`,
    categoryAndPatternWait: "La catégorie et le nombre de lettres apparaîtront au début du dessin.",
    personReady: (name) => `${name} se prépare`,
    personIsDrawing: (name) => `${name} dessine`,
    undo: "Annuler le dernier trait",
    selected: " (sélectionné)",
    colorFallback: "Couleur",
    colors: {
      "#000000": "Noir",
      "#e02424": "Rouge",
      "#1f6feb": "Bleu",
      "#22a34a": "Vert",
      "#f4c20d": "Jaune",
      "#ef7d1a": "Orange",
      "#8b3fb0": "Violet",
      "#6b4a2f": "Marron",
    },
    yourGuess: "Votre réponse",
    guess: "Valider",
    guessHint: "Saisissez le mot exact puis appuyez sur Valider.",
    wordPattern: (pattern) => `Nombre de lettres : ${pattern}`,
    someoneGuessedFirst: (name) => `${name} a trouvé le mot en premier !`,
    skipped: "Tour annulé : le dessinateur s’est déconnecté",
    noGuessers: "Aucun joueur ne peut proposer de réponse",
    timeUp: "Le temps est écoulé",
    finishedDrawing: "Dessin terminé",
    wordWas: "Le mot était :",
    winner: "La personne gagnante",
    drawer: "Le dessinateur",
    noPoints: "Aucun point attribué",
    nextTurn: "Prochain tour…",
    leaveRoom: "Quitter la partie",
    roundComplete: (round) => `Fin de la manche ${round}`,
    points: (count) => `${count} point${count > 1 ? "s" : ""}`,
    roundStarting: (round) => `Manche ${round}…`,
    wins: (name) => `${name} a gagné !`,
    jointWinners: "Égalité",
    finalResults: "Résultats finaux",
    scoreboard: "Classement",
    spectatorNotice:
      "Vous avez rejoint la partie comme spectateur. Vous jouerez à la prochaine partie.",
    playAgain: "Rejouer",
    waitingHost: "En attente de la prochaine partie lancée par l’hôte…",
    gameTitle: "Dessin et devinettes",
    gameDescription:
      "Une personne dessine un mot secret et les autres doivent le deviner en direct.",
    players: (count) => `Joueurs (${count})`,
    host: "hôte",
    lobbyReconnecting: "reconnexion",
    lobbyWaiting:
      "La première manche commencera automatiquement quand tout le monde aura rejoint la partie.",
  },
};

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
  const copy = DRAWING_COPY[state.language];

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
          incorrect: copy.incorrect,
          "not-active": copy.notActive,
          "not-guesser": copy.notGuesser,
          invalid: copy.invalidGuess,
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
  }, [connection.room, copy]);

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
        copy={copy}
      />
    );
  }
  if (state.phase === "result") {
    return <ResultView connection={connection} state={state} copy={copy} />;
  }
  if (state.phase === "round-summary") {
    return <RoundSummaryView state={state} copy={copy} />;
  }
  if (state.phase === "finished") {
    return (
      <FinishedView
        connection={connection}
        state={state}
        selfSessionId={selfSessionId}
        roomError={roomError}
        copy={copy}
      />
    );
  }
  return <LobbyView connection={connection} state={state} roomError={roomError} copy={copy} />;
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
  copy,
}: {
  connection: RoomConnection;
  state: LiveDrawingGuessingState;
  self: LiveDrawingPlayerState | undefined;
  isSpectator: boolean;
  drawerBriefing: LiveDrawingDrawerBriefing | null;
  guessFeedback: string | null;
  clearGuessFeedback: () => void;
  roomError: string | null;
  copy: DrawingCopy;
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
      lang={state.language}
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
          {copy.roundTurn(state.roundNumber, state.totalRounds, state.turnNumber, state.totalTurns)}
        </Typography>
        <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>
          {preparing ? `${secondsLeft}` : copy.seconds(secondsLeft)}
        </Typography>
        {isSpectator && (
          <Chip label={copy.spectating} size="small" variant="outlined" color="info" />
        )}
        {(connection.reconnecting || self?.connectionStatus !== "connected") &&
          self !== undefined && (
            <Chip label={copy.reconnecting} size="small" variant="outlined" color="warning" />
          )}
        <Button
          type="button"
          size="small"
          variant="text"
          sx={{ ml: "auto" }}
          onClick={() => connection.leave()}
        >
          {copy.leave}
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
        {isDrawer && <DrawerInfo briefing={drawerBriefing} preparing={preparing} copy={copy} />}
        {isGuesser && (
          <GuesserInfo state={state} preparing={preparing} drawer={drawer} copy={copy} />
        )}
        {isSpectator && (
          <SpectatorInfo state={state} preparing={preparing} drawer={drawer} copy={copy} />
        )}

        <Box sx={{ flex: 1, minHeight: 0 }}>
          <DrawingCanvas
            strokes={[...state.strokes]}
            interactive={isDrawer && !preparing && !connection.reconnecting}
            ariaLabel={isDrawer ? copy.canvasDrawing : copy.canvas}
            testId="ldg-canvas"
            color={paletteColor}
            phase={state.phase}
            turnNumber={state.turnNumber}
            onStrokeBatch={sendStrokeBatch}
          />
        </Box>

        {state.phase === "preparing" && state.turnNumber === 1 && (
          <HowToPlay
            title={copy.howToPlay}
            points={isDrawer ? copy.drawerRules : copy.guesserRules}
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
          copy={copy}
        />
      )}
      {isGuesser && !preparing && !connection.reconnecting && (
        <GuesserControls
          connection={connection}
          feedback={guessFeedback}
          onSent={clearGuessFeedback}
          copy={copy}
        />
      )}
      {preparing && (
        <Paper square sx={{ p: 1.25 }}>
          <Typography align="center" aria-live="polite" variant="body2">
            {isDrawer ? copy.readyToDraw : copy.drawerReady(drawer?.name ?? copy.drawer)}
          </Typography>
        </Paper>
      )}
    </Box>
  );
}

function DrawerInfo({
  briefing,
  preparing,
  copy,
}: {
  briefing: LiveDrawingDrawerBriefing | null;
  preparing: boolean;
  copy: DrawingCopy;
}) {
  return (
    <Paper sx={{ p: 1.25 }}>
      <Stack spacing={0.5}>
        <Typography variant="h2">{copy.youAreDrawing}</Typography>
        <Typography
          variant="h1"
          sx={{ fontSize: "1.8rem", wordBreak: "break-word" }}
          data-testid="ldg-drawer-word"
          aria-live="polite"
        >
          {preparing ? (briefing?.word ?? "…") : (briefing?.word ?? "…")}
        </Typography>
        {briefing !== null && (
          <Typography color="text.secondary">{copy.category(briefing.category)}</Typography>
        )}
        {preparing && <Typography color="text.secondary">{copy.drawNoLetters}</Typography>}
      </Stack>
    </Paper>
  );
}

function GuesserInfo({
  state,
  preparing,
  drawer,
  copy,
}: {
  state: LiveDrawingGuessingState;
  preparing: boolean;
  drawer: LiveDrawingPlayerState | undefined;
  copy: DrawingCopy;
}) {
  return (
    <Paper sx={{ p: 1.25 }}>
      <Stack spacing={0.5}>
        <Typography variant="h2" data-testid="ldg-drawer-name">
          {copy.personDrawing(drawer?.name ?? copy.someone)}
        </Typography>
        {!preparing && (
          <>
            <Typography color="text.secondary">{copy.category(state.wordCategory)}</Typography>
            <LetterPattern pattern={[...state.letterPattern]} copy={copy} />
          </>
        )}
        {preparing && <Typography color="text.secondary">{copy.categoryAndPatternWait}</Typography>}
      </Stack>
    </Paper>
  );
}

function SpectatorInfo({
  state,
  preparing,
  drawer,
  copy,
}: {
  state: LiveDrawingGuessingState;
  preparing: boolean;
  drawer: LiveDrawingPlayerState | undefined;
  copy: DrawingCopy;
}) {
  return (
    <Paper sx={{ p: 1.25 }}>
      <Stack spacing={0.5}>
        <Typography variant="h2">{copy.spectating}</Typography>
        <Typography variant="body2">
          {preparing
            ? copy.personReady(drawer?.name ?? copy.drawer)
            : copy.personIsDrawing(drawer?.name ?? copy.drawer)}
        </Typography>
        {!preparing && (
          <>
            <Typography color="text.secondary">{copy.category(state.wordCategory)}</Typography>
            <LetterPattern pattern={[...state.letterPattern]} copy={copy} />
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
  copy,
}: {
  connection: RoomConnection;
  state: LiveDrawingGuessingState;
  selectedColor: string;
  onSelectColor: (color: string) => void;
  copy: DrawingCopy;
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
              copy={copy}
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
          {copy.undo}
        </Button>
      </Stack>
    </Paper>
  );
}

function ColorSwatch({
  color,
  selected,
  onSelect,
  copy,
}: {
  color: string;
  selected: boolean;
  onSelect: () => void;
  copy: DrawingCopy;
}) {
  return (
    <Button
      type="button"
      aria-label={`${copy.colors[color] ?? copy.colorFallback}${selected ? copy.selected : ""}`}
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
  copy,
}: {
  connection: RoomConnection;
  feedback: string | null;
  onSent: () => void;
  copy: DrawingCopy;
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
            label={copy.yourGuess}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            inputRef={inputRef}
            value={guess}
            onChange={(event) => setGuess(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 80, "data-testid": "ldg-guess-input" } }}
          />
          <Button type="submit" fullWidth data-testid="ldg-guess-submit">
            {copy.guess}
          </Button>
          <Typography
            variant="body2"
            align="center"
            aria-live="polite"
            data-testid="ldg-guess-feedback"
          >
            {feedback ?? copy.guessHint}
          </Typography>
        </Stack>
      </Box>
    </Paper>
  );
}

function LetterPattern({ pattern, copy }: { pattern: readonly string[]; copy: DrawingCopy }) {
  const text = pattern.join("");
  return (
    <Typography
      component="div"
      aria-label={copy.wordPattern(text)}
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
  copy,
}: {
  connection: RoomConnection;
  state: LiveDrawingGuessingState;
  copy: DrawingCopy;
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
      ? copy.someoneGuessedFirst(winner?.name ?? copy.someone)
      : result.outcome === "skipped"
        ? copy.skipped
        : result.outcome === "no-guessers"
          ? copy.noGuessers
          : copy.timeUp;

  return (
    <Box
      component="main"
      lang={state.language}
      sx={{ display: "flex", flexDirection: "column", height: "100dvh", width: "100%" }}
    >
      <Box sx={{ flex: 1, minHeight: 0, p: 1 }}>
        <DrawingCanvas
          strokes={[...state.strokes]}
          interactive={false}
          ariaLabel={copy.finishedDrawing}
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
            {copy.wordWas}
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
                  {winner?.name ?? copy.winner} +1
                </Typography>
                <Typography>{drawer?.name ?? copy.drawer} +1</Typography>
              </>
            ) : (
              <Typography>{copy.noPoints}</Typography>
            )}
          </Stack>
          <Typography color="text.secondary" sx={{ mt: 2 }} aria-live="polite">
            {copy.nextTurn}
          </Typography>
          <Button
            type="button"
            size="small"
            variant="text"
            sx={{ mt: 1 }}
            onClick={() => connection.leave()}
          >
            {copy.leaveRoom}
          </Button>
        </Paper>
      </Box>
    </Box>
  );
}

function RoundSummaryView({ state, copy }: { state: LiveDrawingGuessingState; copy: DrawingCopy }) {
  const nextRound = state.roundNumber + 1;
  return (
    <Box
      component="main"
      lang={state.language}
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
          {copy.roundComplete(state.roundNumber)}
        </Typography>
        <List disablePadding sx={{ mt: 2 }}>
          {[...state.players.values()]
            .filter((player) => !player.isSpectator)
            .sort((a, b) => b.score - a.score || a.joinedOrder - b.joinedOrder)
            .map((player) => (
              <ListItem key={player.playerId} disableGutters sx={{ gap: 1 }}>
                <Typography sx={{ flex: 1, fontWeight: 600 }}>{player.name}</Typography>
                <Typography sx={{ fontWeight: 800 }}>{copy.points(player.score)}</Typography>
              </ListItem>
            ))}
        </List>
        <Typography align="center" color="text.secondary" sx={{ mt: 2 }} aria-live="polite">
          {copy.roundStarting(nextRound)}
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
  copy,
}: {
  connection: RoomConnection;
  state: LiveDrawingGuessingState;
  selfSessionId: string;
  roomError: string | null;
  copy: DrawingCopy;
}) {
  const result = state.result;
  const self = selfPlayer(state, selfSessionId);
  const isHost = state.hostSessionId === selfSessionId;
  const winnerNames = result
    ? result.winnerPlayerIds
        .map((playerId) => state.players.get(playerId)?.name)
        .filter((name): name is string => name !== undefined)
    : [];
  const headline = winnerNames.length === 1 ? copy.wins(winnerNames[0] ?? "") : copy.jointWinners;

  return (
    <Stack
      component="main"
      lang={state.language}
      spacing={2}
      sx={{ p: { xs: 2, sm: 3 }, width: "100%", overflowY: "auto" }}
    >
      <Box component="header">
        <Typography component="h1" variant="h1">
          {copy.finalResults}
        </Typography>
        <Typography component="h2" variant="h2" aria-live="polite">
          {headline}
        </Typography>
      </Box>

      <Paper component="section" aria-labelledby="ldg-leaderboard-heading" sx={{ p: 2.25 }}>
        <Typography component="h2" variant="h2" id="ldg-leaderboard-heading">
          {copy.scoreboard}
        </Typography>
        <List disablePadding sx={{ mt: 1 }} data-testid="ldg-leaderboard">
          {result?.leaderboard.map((entry) => (
            <ListItem key={entry.playerId} disableGutters sx={{ gap: 1 }}>
              <Typography sx={{ minWidth: 32, fontWeight: 800 }}>#{entry.rank}</Typography>
              <Typography sx={{ flex: 1, fontWeight: 600 }}>{entry.label}</Typography>
              <Typography sx={{ fontWeight: 800 }}>{copy.points(entry.score)}</Typography>
            </ListItem>
          ))}
        </List>
      </Paper>

      {self?.isSpectator === true && <Alert severity="info">{copy.spectatorNotice}</Alert>}
      {roomError !== null && <Alert severity="error">{roomError}</Alert>}

      {isHost ? (
        <Button
          type="button"
          fullWidth
          data-testid="ldg-play-again"
          onClick={() => connection.room.send(ROOM_MESSAGE_TYPES.playAgain, {})}
        >
          {copy.playAgain}
        </Button>
      ) : (
        <Paper sx={{ p: 2.25 }}>
          <Typography color="text.secondary" aria-live="polite">
            {copy.waitingHost}
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
        {copy.leaveRoom}
      </Button>
    </Stack>
  );
}

function LobbyView({
  connection,
  state,
  roomError,
  copy,
}: {
  connection: RoomConnection;
  state: LiveDrawingGuessingState;
  roomError: string | null;
  copy: DrawingCopy;
}) {
  return (
    <Stack
      component="main"
      lang={state.language}
      spacing={2}
      sx={{ p: { xs: 2, sm: 3 }, width: "100%" }}
    >
      <Box component="header">
        <Typography component="h1" variant="h1">
          {copy.gameTitle}
        </Typography>
        <Typography color="text.secondary">{copy.gameDescription}</Typography>
      </Box>

      <Paper component="section" aria-labelledby="ldg-players-heading" sx={{ p: 2.25 }}>
        <Typography component="h2" variant="h2" id="ldg-players-heading">
          {copy.players(state.players.size)}
        </Typography>
        <List disablePadding sx={{ mt: 1 }}>
          {[...state.players.values()]
            .sort((a, b) => a.joinedOrder - b.joinedOrder)
            .map((player) => (
              <ListItem key={player.playerId} disableGutters sx={{ gap: 1 }}>
                <Typography sx={{ flex: 1, fontWeight: 600 }}>{player.name}</Typography>
                {player.isHost && <Chip label={copy.host} size="small" variant="outlined" />}
                {player.connectionStatus !== "connected" && (
                  <Chip
                    label={copy.lobbyReconnecting}
                    size="small"
                    color="warning"
                    variant="outlined"
                  />
                )}
              </ListItem>
            ))}
        </List>
      </Paper>

      <InvitePanel code={state.roomCode} language={state.language} />

      {roomError !== null && <Alert severity="error">{roomError}</Alert>}

      <Paper sx={{ p: 2.25 }}>
        <Typography color="text.secondary" aria-live="polite">
          {copy.lobbyWaiting}
        </Typography>
      </Paper>

      <Button
        type="button"
        variant="outlined"
        color="error"
        fullWidth
        onClick={() => connection.leave()}
      >
        {copy.leaveRoom}
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
