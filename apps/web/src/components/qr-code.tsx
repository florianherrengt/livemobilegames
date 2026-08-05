import { Box, CircularProgress, Stack, Typography } from "@mui/material";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

export function QrCode({ value }: { value: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { width: 180, margin: 1 })
      .then((url) => {
        if (!cancelled) {
          setDataUrl(url);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDataUrl(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [value]);

  if (dataUrl === null) {
    return (
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", justifyContent: "center" }}>
        <CircularProgress size={20} aria-hidden="true" />
        <Typography color="text.secondary">Generating QR code…</Typography>
      </Stack>
    );
  }
  return (
    <Box
      component="img"
      src={dataUrl}
      alt={`QR code for ${value}`}
      sx={{
        width: 180,
        height: 180,
        mx: "auto",
        borderRadius: 1,
        bgcolor: "common.white",
        p: 0.75,
      }}
    />
  );
}
