import QRCode from "qrcode";

/**
 * Builds a shareable invite URL for a room. Any existing query parameters
 * (for example a launcher hand-off name) are replaced with the room code so
 * the link works for anyone, not just the player who created the room.
 */
export function buildInviteUrl(code: string, base: string): string {
  const url = new URL(base);
  const params = new URLSearchParams();
  params.set("code", code.toUpperCase());
  url.search = params.toString();
  url.hash = "";
  return url.toString();
}

export interface QrCodeOptions {
  width?: number;
  margin?: number;
}

/**
 * Renders a QR code for `url` into `target`, replacing its previous content.
 * The QR is drawn on a white canvas so scanners work against dark themes.
 */
export async function renderQrCode(
  target: HTMLElement,
  url: string,
  options: QrCodeOptions = {},
): Promise<void> {
  target.replaceChildren();
  const canvas = document.createElement("canvas");
  await QRCode.toCanvas(canvas, url, {
    width: options.width ?? 180,
    margin: options.margin ?? 1,
    errorCorrectionLevel: "M",
  });
  target.append(canvas);
}
