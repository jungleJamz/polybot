import express from "express";
import path from "path";
import { state } from "./state.js";
import { log } from "../logger.js";

const PORT = Number(process.env.DASHBOARD_PORT ?? 3000);

export function startUI(): void {
  const app = express();
  const publicDir = path.join(process.cwd(), "public");

  app.use(express.static(publicDir));
  app.get("/api/status", (_req, res) => res.json(state));
  app.use((_req, res) => res.sendFile(path.join(publicDir, "index.html")));

  app.listen(PORT, () => log.info(`[ui] http://localhost:${PORT}`));
}
