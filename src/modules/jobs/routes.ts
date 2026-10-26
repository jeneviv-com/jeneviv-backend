import { timingSafeEqual } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { jobs, listJobs } from "../../jobs/registry.js";
import { env } from "../../env.js";
import { HttpError } from "../../middleware/error.js";

export const jobsRouter = Router();

// Keep error bodies short. Cron services (cron-job.org etc.) reject oversized
// responses, and full upstream error text belongs in the server logs, not here.
const MAX_ERROR_MESSAGE_LENGTH = 300;

function requireCronSecret(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const secret = env.CRON_SECRET;
  if (!secret) {
    next(
      new HttpError(
        503,
        "cron_secret_not_configured",
        "CRON_SECRET must be set to run scheduled jobs",
      ),
    );
    return;
  }
  const header = req.header("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    next(new HttpError(401, "unauthorized", "Invalid cron secret"));
    return;
  }
  next();
}

jobsRouter.get("/", (_req, res) => {
  res.json({ jobs: listJobs() });
});

jobsRouter.post("/:name/run", requireCronSecret, async (req, res, next) => {
  const name = req.params.name;
  if (typeof name !== "string" || name.length === 0) {
    next(new HttpError(400, "bad_request", "Job name required"));
    return;
  }
  const job = jobs[name];
  if (!job) {
    next(new HttpError(404, "not_found", `Job not found: ${name}`));
    return;
  }
  const startedAt = Date.now();
  try {
    const result = await job.run();
    res.json({
      job: name,
      status: "ok",
      duration_ms: Date.now() - startedAt,
      result,
    });
  } catch (err) {
    const fullMessage = err instanceof Error ? err.message : String(err);
    console.error(`[jobs] ${name} failed:`, err);
    res.status(500).json({
      job: name,
      status: "error",
      duration_ms: Date.now() - startedAt,
      message: fullMessage.slice(0, MAX_ERROR_MESSAGE_LENGTH),
    });
  }
});
