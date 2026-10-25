import { FormControl, InputLabel, MenuItem, Paper, Select, Stack, Typography } from "@mui/material";
import {
  type GameManifest,
  LIVE_DRAWING_GUESSING_GAME_ID,
  type LiveDrawingLanguage,
} from "@phone-party/protocol";

/**
 * Presentational game selection used inside the connected GameSelect wrapper.
 * Kept network-free so Storybook can render deterministic states.
 */
export function GameSelectForm({
  games,
  selectedGameId,
  isHost,
  onSelect,
  language,
  onSelectLanguage,
}: {
  games: readonly GameManifest[];
  selectedGameId: string;
  isHost: boolean;
  onSelect: (gameId: string) => void;
  language: LiveDrawingLanguage;
  onSelectLanguage: (language: LiveDrawingLanguage) => void;
}) {
  const selectedGame = games.find((game) => game.id === selectedGameId);
  return (
    <Paper component="section" aria-labelledby="game-select-heading" sx={{ p: 2.25 }}>
      <Stack spacing={1.5}>
        <Typography component="h2" variant="h2" id="game-select-heading">
          Game
        </Typography>
        {isHost ? (
          <FormControl fullWidth>
            <InputLabel id="game-select-label">Choose a game</InputLabel>
            <Select
              labelId="game-select-label"
              label="Choose a game"
              value={selectedGameId}
              onChange={(event) => onSelect(String(event.target.value))}
            >
              {games.map((game) => (
                <MenuItem key={game.id} value={game.id}>
                  {game.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        ) : (
          <Typography color="text.secondary">
            {selectedGame !== undefined
              ? `The host selected ${selectedGame.name}.`
              : "Waiting for the host to choose a game…"}
          </Typography>
        )}
        {selectedGame !== undefined && (
          <Typography color="text.secondary">{selectedGame.description}</Typography>
        )}
        {selectedGameId === LIVE_DRAWING_GUESSING_GAME_ID &&
          (isHost ? (
            <FormControl fullWidth>
              <InputLabel id="drawing-language-label">Language / Langue</InputLabel>
              <Select
                labelId="drawing-language-label"
                label="Language / Langue"
                value={language}
                onChange={(event) => onSelectLanguage(event.target.value)}
              >
                <MenuItem value="en">English</MenuItem>
                <MenuItem value="fr">Français</MenuItem>
              </Select>
            </FormControl>
          ) : (
            <Typography color="text.secondary" aria-live="polite">
              {language === "fr" ? "Langue : Français" : "Language: English"}
            </Typography>
          ))}
      </Stack>
    </Paper>
  );
}
