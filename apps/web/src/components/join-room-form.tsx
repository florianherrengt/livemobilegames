import { zodResolver } from "@hookform/resolvers/zod";
import { Box, Button, Paper, Stack, TextField, Typography } from "@mui/material";
import { normalizeRoomCode, playerNameSchema, roomCodeSchema } from "@phone-party/protocol";
import { useController, useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { z } from "zod";

import { apiErrorMessage } from "../api.js";
import { useRoomConnection } from "../game-connection.js";
import { useJoinRoomMutation } from "../queries/rooms.js";

const joinRoomFormSchema = z.object({
  roomCode: z
    .string()
    .trim()
    .min(1, "Enter a room code")
    .transform(normalizeRoomCode)
    .pipe(roomCodeSchema),
  playerName: playerNameSchema,
});

type JoinRoomFormValues = z.infer<typeof joinRoomFormSchema>;

export function JoinRoomForm() {
  const navigate = useNavigate();
  const { connect } = useRoomConnection();
  const joinRoom = useJoinRoomMutation(connect);
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<JoinRoomFormValues>({
    resolver: zodResolver(joinRoomFormSchema),
    defaultValues: { roomCode: "", playerName: "" },
  });
  const { field: roomCodeField } = useController({ name: "roomCode", control });

  const onSubmit = handleSubmit(async (values) => {
    try {
      const result = await joinRoom.mutateAsync({
        code: values.roomCode,
        input: { playerName: values.playerName },
      });
      navigate(`/room/${encodeURIComponent(result.room.code)}`);
    } catch {
      // TanStack Query owns and exposes the mutation error below.
    }
  });

  const pending = isSubmitting || joinRoom.isPending;

  return (
    <Paper component="section" aria-labelledby="join-room-heading" sx={{ p: 2.25 }}>
      <Stack spacing={2}>
        <Typography component="h2" variant="h2" id="join-room-heading">
          Join a room
        </Typography>
        <Box component="form" onSubmit={onSubmit} noValidate>
          <Stack spacing={2}>
            <TextField
              id="room-code"
              label="Room code"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              error={errors.roomCode !== undefined}
              helperText={errors.roomCode?.message}
              disabled={pending}
              slotProps={{ htmlInput: { maxLength: 6 } }}
              {...roomCodeField}
              onChange={(event) => roomCodeField.onChange(event.target.value.toUpperCase())}
            />
            <TextField
              id="join-player-name"
              label="Your name"
              autoComplete="nickname"
              error={errors.playerName !== undefined}
              helperText={errors.playerName?.message}
              disabled={pending}
              {...register("playerName")}
            />
            {joinRoom.isError && (
              <Typography color="error" role="alert">
                {apiErrorMessage(joinRoom.error, "Could not join the room")}
              </Typography>
            )}
            <Button type="submit" disabled={pending} fullWidth>
              {pending ? "Joining…" : "Join room"}
            </Button>
          </Stack>
        </Box>
      </Stack>
    </Paper>
  );
}
