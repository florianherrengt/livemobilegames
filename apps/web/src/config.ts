/**
 * Single typed access layer for web environment values. Vite injects
 * import.meta.env at build time; runtime code imports this module instead of
 * reading environment variables directly.
 */
const mapStyleUrlValue = import.meta.env.VITE_MAP_STYLE_URL as string | undefined;
const colyseusPathValue = import.meta.env.VITE_COLYSEUS_PATH as string | undefined;

export const webConfig = {
  colyseusPath: (typeof colyseusPathValue === "string" && colyseusPathValue.trim() !== ""
    ? colyseusPathValue.trim()
    : "/colyseus"
  ).replace(/\/$/, ""),
  mapStyleUrl:
    typeof mapStyleUrlValue === "string" && mapStyleUrlValue.trim() !== ""
      ? mapStyleUrlValue.trim()
      : "https://tiles.openfreemap.org/styles/positron",
} as const;
