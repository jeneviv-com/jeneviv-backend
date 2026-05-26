import express from "express";

export const webhookRawBody = express.raw({ type: "application/json" });
