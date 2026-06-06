import { Router, type Request, type Response } from "express";
import {
  ingestFlutterwaveWebhook,
  ingestPaystackWebhook,
} from "./service.js";

export const webhooksRouter = Router();

webhooksRouter.post("/flutterwave", async (req: Request, res: Response) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  const { result, httpStatus } = await ingestFlutterwaveWebhook(
    rawBody,
    req.headers,
  );
  res.status(httpStatus).json(result);
});

webhooksRouter.post("/paystack", async (req: Request, res: Response) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  const { result, httpStatus } = await ingestPaystackWebhook(
    rawBody,
    req.headers,
  );
  res.status(httpStatus).json(result);
});
