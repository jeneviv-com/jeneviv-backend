import * as dotenv from "dotenv";
dotenv.config();

import { toNodeHandler } from "better-auth/node";
import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auth } from "./auth.js";

const app = express();
const port = Number(process.env.PORT ?? 3300);

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(currentDir, "../public");

if (existsSync(publicDir)) {
  app.use(express.static(publicDir));
}

app.all("/api/auth", toNodeHandler(auth));
app.all("/api/auth/{*any}", toNodeHandler(auth));
app.use(express.json());

app.get("/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.listen(port, () => {
  console.log(`[START] JENEVIV BACKEND server listening on port ${port}`);
});
