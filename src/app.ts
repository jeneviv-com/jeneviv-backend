import * as dotenv from "dotenv";
dotenv.config();

import { toNodeHandler } from "better-auth/node";
import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auth } from "./auth.js";
import { env } from "./env.js";
import { cors } from "./middleware/cors.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import { webhookRawBody } from "./middleware/raw-body.js";
import { snakeCaseResponses } from "./middleware/snake-case.js";
import { adminRouter } from "./modules/admin/routes.js";
import { approvalsRouter } from "./modules/approvals/routes.js";
import { banksRouter } from "./modules/banks/routes.js";
import { collectionsRouter } from "./modules/collections/routes.js";
import { groupsRouter } from "./modules/groups/routes.js";
import { jobsRouter } from "./modules/jobs/routes.js";
import { merchantsRouter } from "./modules/merchants/routes.js";
import { paymentsRouter } from "./modules/payments/routes.js";
import { payoutsRouter } from "./modules/payouts/routes.js";
import { refundsRouter } from "./modules/refunds/routes.js";
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

// better-auth owns its own response shape, so this runs after it and before
// every other /api route.
app.use("/api", snakeCaseResponses);

app.use("/api/webhooks", webhookRawBody, webhooksRouter);

app.use(express.json());

app.get("/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.use("/api/merchants", merchantsRouter);
app.use("/api/admin", adminRouter);
app.use("/api/banks", banksRouter);
app.use("/api/templates", templatesRouter);
app.use("/api/collection-groups", groupsRouter);
app.use("/api/collections", collectionsRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/transactions", transactionsRouter);
app.use("/api/payouts", payoutsRouter);
app.use("/api/refunds", refundsRouter);
app.use("/api/withdrawals", withdrawalsRouter);
app.use("/api/approvals", approvalsRouter);
app.use("/api/verify", verifyRouter);
app.use("/api/uploads", uploadsRouter);
app.use("/api/jobs", jobsRouter);

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(env.PORT, () => {
  console.log(`[START] JENEVIV BACKEND server listening on port ${env.PORT}`);
});