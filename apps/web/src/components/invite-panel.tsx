import { Button, Paper, Stack, Typography } from "@mui/material";
import { useEffect, useRef, useState } from "react";

import { QrCode } from "./qr-code.js";

async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText !== undefined) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand("copy");
  textarea.remove();
  return ok;
}

export function InvitePanel({ code }: { code: string }) {
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inviteUrl = `${window.location.origin}/room/${code}`;
  const canShare = typeof navigator.share === "function";

  useEffect(
    () => () => {
      if (resetTimer.current !== null) {
        clearTimeout(resetTimer.current);
      }
    },
    [],
  );

  const copy = async (kind: "code" | "link", value: string): Promise<void> => {
    try {
      await copyText(value);
      setCopied(kind);
      if (resetTimer.current !== null) {
        clearTimeout(resetTimer.current);
      }
      resetTimer.current = setTimeout(() => setCopied(null), 2_000);
    } catch {
      setCopied(null);
    }
  };

  const share = async (): Promise<void> => {
    try {
      await navigator.share({ title: "Join my Phone Party room", url: inviteUrl });
    } catch {
      // User cancelled the share sheet; no error UI needed.
    }
  };

  return (
    <Paper component="section" aria-labelledby="invite-heading" sx={{ p: 2.25 }}>
      <Stack spacing={2} sx={{ alignItems: "stretch", textAlign: "center" }}>
        <Typography component="h2" variant="h2" id="invite-heading">
          Invite players
        </Typography>
        <Typography
          data-testid="room-code"
          sx={{ fontSize: "2.4rem", fontWeight: 800, letterSpacing: "0.12em" }}
        >
          {code}
        </Typography>
        <Typography color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
          {inviteUrl}
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25}>
          <Button type="button" onClick={() => copy("code", code)} fullWidth>
            {copied === "code" ? "Copied!" : "Copy code"}
          </Button>
          <Button type="button" onClick={() => copy("link", inviteUrl)} fullWidth>
            {copied === "link" ? "Copied!" : "Copy invite link"}
          </Button>
          {canShare && (
            <Button type="button" onClick={share} fullWidth>
              Share
            </Button>
          )}
        </Stack>
        <QrCode value={inviteUrl} />
      </Stack>
    </Paper>
  );
}
