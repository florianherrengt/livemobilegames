import {
  Avatar,
  Chip,
  List,
  ListItem,
  ListItemAvatar,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import type { LobbyPlayerState } from "@phone-party/protocol";

function colorFor(playerId: string): string {
  const hash = [...playerId].reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) >>> 0, 0);
  return `hsl(${hash % 360} 65% 40%)`;
}

export function PlayerList({
  players,
  selfSessionId,
}: {
  players: Map<string, LobbyPlayerState>;
  selfSessionId: string;
}) {
  const entries = [...players.entries()];

  return (
    <Paper component="section" aria-labelledby="players-heading" sx={{ p: 2.25 }}>
      <Typography component="h2" variant="h2" id="players-heading">
        Players ({entries.length})
      </Typography>
      <List disablePadding sx={{ mt: 1 }}>
        {entries.map(([sessionId, player]) => (
          <ListItem key={sessionId} disableGutters>
            <ListItemAvatar>
              <Avatar sx={{ bgcolor: colorFor(player.playerId), color: "common.white" }}>
                {player.name.slice(0, 1).toUpperCase()}
              </Avatar>
            </ListItemAvatar>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
              <Typography sx={{ fontWeight: 600 }}>
                {player.name}
                {sessionId === selfSessionId && (
                  <Typography component="span" color="text.secondary">
                    {" "}
                    (you)
                  </Typography>
                )}
              </Typography>
              {player.isHost && <Chip label="host" size="small" variant="outlined" />}
            </Stack>
          </ListItem>
        ))}
      </List>
    </Paper>
  );
}
