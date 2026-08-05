import { Box, Container, Stack, Typography } from "@mui/material";

import { CreateRoomForm } from "../components/create-room-form.js";
import { JoinRoomForm } from "../components/join-room-form.js";

export function HomePage() {
  return (
    <Container component="main" maxWidth="sm" sx={{ py: { xs: 2.5, sm: 4 } }}>
      <Stack spacing={2}>
        <Box component="header">
          <Typography component="h1" variant="h1" gutterBottom>
            Phone Party
          </Typography>
          <Typography color="text.secondary">
            Multiplayer party games for a room full of phones. No shared screen required.
          </Typography>
        </Box>

        <CreateRoomForm />
        <JoinRoomForm />
      </Stack>
    </Container>
  );
}
