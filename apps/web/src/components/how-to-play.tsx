import { Paper, Stack, Typography } from "@mui/material";

export function HowToPlay({
  title,
  points,
  testId = "how-to-play",
}: {
  title: string;
  points: readonly string[];
  testId?: string;
}) {
  return (
    <Paper
      component="aside"
      role="region"
      aria-label={title}
      data-testid={testId}
      sx={{
        position: "absolute",
        top: 12,
        left: 12,
        right: 12,
        mx: "auto",
        maxWidth: 420,
        zIndex: 20,
        p: 2,
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Stack spacing={1}>
        <Typography component="h2" variant="h2">
          {title}
        </Typography>
        <Stack component="ul" spacing={0.5} sx={{ m: 0, p: 0, listStyle: "none" }}>
          {points.map((point) => (
            <Typography
              component="li"
              key={point}
              variant="body2"
              sx={{ pl: 1.5, textIndent: "-1.5em" }}
            >
              {point}
            </Typography>
          ))}
        </Stack>
      </Stack>
    </Paper>
  );
}
