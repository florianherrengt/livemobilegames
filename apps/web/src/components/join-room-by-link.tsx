import { Box, Button, Paper, Stack, TextField, Typography } from "@mui/material";
import { normalizeRoomCode, playerNameSchema } from "@phone-party/protocol";
import { type FormEvent, useState } from "react";
import { z } from "zod";

import { apiErrorMessage } from "../api.js";
import { useRoomConnection } from "../game-connection.js";
import { useJoinRoomMutation } from "../queries/rooms.js";

const joinLinkSchema = z.object({
  playerName: playerNameSchema,
});

export function JoinRoomByLink({ code }: { code: string }) {
  const { connect } = useRoomConnection();
  const joinRoom = useJoinRoomMutation(connect);
  const [playerName, setPlayerName] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    joinRoom.reset();
    const parsed = joinLinkSchema.safeParse({ playerName });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? "Enter your name");
      return;
    }
    setFieldError(null);
    try {
      await joinRoom.mutateAsync({ code, input: parsed.data });
    } catch {
      // TanStack Query owns and exposes the mutation error below.
    }
  };

  return (
    <Paper component="section" aria-labelledby="join-link-heading" sx={{ p: 2.25 }}>
      <Stack spacing={2}>
        <Typography component="h2" variant="h2" id="join-link-heading">
          Join room {normalizeRoomCode(code)}
        </Typography>
        <Box component="form" onSubmit={onSubmit} noValidate>
          <Stack spacing={2}>
            <TextField
              id="join-link-name"
              label="Your name"
              autoComplete="nickname"
              value={playerName}
              onChange={(event) => setPlayerName(event.target.value)}
              error={fieldError !== null}
              helperText={fieldError}
              disabled={joinRoom.isPending}
            />
            {joinRoom.isError && (
              <Typography color="error" role="alert">
                {apiErrorMessage(joinRoom.error, "Could not join the room")}
              </Typography>
            )}
            <Button type="submit" disabled={joinRoom.isPending} fullWidth>
              {joinRoom.isPending ? "Joining…" : "Join room"}
            </Button>
          </Stack>
        </Box>
      </Stack>
    </Paper>
  );
}
