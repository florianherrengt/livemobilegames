const DEFAULT_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

export function getMapStyleUrl(): string {
  const env = import.meta.env.VITE_MAP_STYLE_URL;
  if (typeof env === "string" && env.trim() !== "") {
    return env.trim();
  }
  return DEFAULT_STYLE_URL;
}
