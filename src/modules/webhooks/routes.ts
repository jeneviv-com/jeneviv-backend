import { Router, type Request, type Response } from "express";
import { ingestFlutterwaveWebhook } from "./service.js";

export const webhooksRouter = Router();

webhooksRouter.post("/flutterwave", async (req: Request, res: Response) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  const { result, httpStatus } = await ingestFlutterwaveWebhook(
    rawBody,
    req.headers,
  );
  res.status(httpStatus).json(result);
});
