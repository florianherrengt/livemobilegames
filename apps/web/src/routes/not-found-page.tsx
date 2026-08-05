import { Button, Container, Paper, Stack, Typography } from "@mui/material";
import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <Container component="main" maxWidth="sm" sx={{ py: { xs: 2.5, sm: 4 } }}>
      <Paper sx={{ p: 2.25 }}>
        <Stack spacing={2}>
          <Typography component="h1" variant="h1">
            Page not found
          </Typography>
          <Typography color="text.secondary">
            The page you are looking for does not exist.
          </Typography>
          <Button component={Link} to="/">
            Return home
          </Button>
        </Stack>
      </Paper>
    </Container>
  );
}
