import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineRoom, defineServer } from "colyseus";
import express from "express";

import { FallingPlatformsRoom } from "./rooms/FallingPlatformsRoom.js";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const clientDist = path.resolve(packageDir, "../client/dist");

export const appConfig = defineServer({
  rooms: {
    falling_platforms: defineRoom(FallingPlatformsRoom),
  },
  express: (app) => {
    app.use(express.static(clientDist, { index: "index.html" }));
    app.get("/health", (_req, res) => {
      res.json({ ok: true });
    });
  },
});
