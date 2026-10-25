import * as dotenv from "dotenv";
dotenv.config();

import { toNodeHandler } from "better-auth/node";
import { eq } from "drizzle-orm"; // ADDED
import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auth } from "./auth.js";
import { db } from "./db/index.js"; // ADDED
import { users } from "./db/schema.js"; // ADDED
import { env } from "./env.js";
import { cors } from "./middleware/cors.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import { webhookRawBody } from "./middleware/raw-body.js";
import { adminRouter } from "./modules/admin/routes.js";
import { approvalsRouter } from "./modules/approvals/routes.js";
import { banksRouter } from "./modules/banks/routes.js";
import { collectionsRouter } from "./modules/collections/routes.js";
import { jobsRouter } from "./modules/jobs/routes.js";
import { merchantsRouter } from "./modules/merchants/routes.js";
import { paymentsRouter } from "./modules/payments/routes.js";
import { payoutsRouter } from "./modules/payouts/routes.js";
import { templatesRouter } from "./modules/templates/routes.js";
import { transactionsRouter } from "./modules/transactions/routes.js";
import { uploadsRouter } from "./modules/uploads/routes.js";
import { verifyRouter } from "./modules/verify/routes.js";
import { webhooksRouter } from "./modules/webhooks/routes.js";
import { withdrawalsRouter } from "./modules/withdrawals/routes.js";

const app = express();

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(currentDir, "../public");

app.use(cors);

if (existsSync(publicDir)) {
  app.use(express.static(publicDir));
}

app.all("/api/auth", toNodeHandler(auth));
app.all("/api/auth/{*any}", toNodeHandler(auth));

app.use("/api/webhooks", webhookRawBody, webhooksRouter);

app.use(express.json());

app.get("/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.use("/api/merchants", merchantsRouter);
app.use("/api/admin", adminRouter);
app.use("/api/banks", banksRouter);
app.use("/api/templates", templatesRouter);
app.use("/api/collections", collectionsRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/transactions", transactionsRouter);
app.use("/api/payouts", payoutsRouter);
app.use("/api/withdrawals", withdrawalsRouter);
app.use("/api/approvals", approvalsRouter);
app.use("/api/verify", verifyRouter);
app.use("/api/uploads", uploadsRouter);
app.use("/api/jobs", jobsRouter);

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(env.PORT, () => {
  console.log(`[START] JENEVIV BACKEND server listening on port ${env.PORT}`);

  // ADDED: one-time admin bootstrap.
  // Set BOOTSTRAP_ADMIN_EMAIL on Render, deploy, check logs, then remove the variable.
  const bootstrapEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  if (bootstrapEmail) {
    db.update(users)
      .set({ role: "admin" })
      .where(eq(users.email, bootstrapEmail))
      .returning({ email: users.email })
      .then((rows) =>
        console.log(
          rows.length
            ? `[BOOTSTRAP] ${rows[0].email} is now admin`
            : `[BOOTSTRAP] no user found for ${bootstrapEmail}`,
        ),
      )
      .catch((err) => console.error("[BOOTSTRAP] failed", err));
  }
});
