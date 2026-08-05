import { zodResolver } from "@hookform/resolvers/zod";
import { Box, Button, Paper, Stack, TextField, Typography } from "@mui/material";
import { playerNameSchema } from "@phone-party/protocol";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { z } from "zod";

import { apiErrorMessage } from "../api.js";
import { useRoomConnection } from "../game-connection.js";
import { useCreateRoomMutation } from "../queries/rooms.js";

const createRoomFormSchema = z.object({
  playerName: playerNameSchema,
});

type CreateRoomFormValues = z.infer<typeof createRoomFormSchema>;

export function CreateRoomForm() {
  const navigate = useNavigate();
  const { connect } = useRoomConnection();
  const createRoom = useCreateRoomMutation(connect);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateRoomFormValues>({
    resolver: zodResolver(createRoomFormSchema),
    defaultValues: { playerName: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      const result = await createRoom.mutateAsync(values);
      navigate(`/room/${encodeURIComponent(result.room.code)}`);
    } catch {
      // TanStack Query owns and exposes the mutation error below.
    }
  });

  const pending = isSubmitting || createRoom.isPending;

  return (
    <Paper component="section" aria-labelledby="create-room-heading" sx={{ p: 2.25 }}>
      <Stack spacing={2}>
        <Typography component="h2" variant="h2" id="create-room-heading">
          Create a room
        </Typography>
        <Box component="form" onSubmit={onSubmit} noValidate>
          <Stack spacing={2}>
            <TextField
              id="create-player-name"
              label="Your name"
              autoComplete="nickname"
              error={errors.playerName !== undefined}
              helperText={errors.playerName?.message}
              disabled={pending}
              {...register("playerName")}
            />
            {createRoom.isError && (
              <Typography color="error" role="alert">
                {apiErrorMessage(createRoom.error, "Could not create the room")}
              </Typography>
            )}
            <Button type="submit" disabled={pending} fullWidth>
              {pending ? "Creating…" : "Create room"}
            </Button>
          </Stack>
        </Box>
      </Stack>
    </Paper>
  );
}
