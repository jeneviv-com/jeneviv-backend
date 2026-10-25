import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import {
  approvalTokenParamSchema,
  approveWithdrawalSchema,
  rejectWithdrawalSchema,
} from "../withdrawals/schemas.js";
import {
  approveWithdrawal,
  getApprovalSummary,
  rejectWithdrawal,
} from "../withdrawals/service.js";

/**
 * Public by design: the treasurer is not a platform user. The unguessable
 * token in the URL scopes access to exactly one sweep, and the OTP sent to the
 * registered phone is still required to approve it.
 */
export const approvalsRouter = Router();

approvalsRouter.get(
  "/:token",
  validate(approvalTokenParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { token } = req.params as { token: string };
      const approval = await getApprovalSummary(token);
      res.json({ approval });
    } catch (err) {
      next(err);
    }
  },
);

approvalsRouter.post(
  "/:token/approve",
  validate(approvalTokenParamSchema, "params"),
  validate(approveWithdrawalSchema),
  async (req, res, next) => {
    try {
      const { token } = req.params as { token: string };
      const result = await approveWithdrawal(token, req.body.otp);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

approvalsRouter.post(
  "/:token/reject",
  validate(approvalTokenParamSchema, "params"),
  validate(rejectWithdrawalSchema),
  async (req, res, next) => {
    try {
      const { token } = req.params as { token: string };
      const result = await rejectWithdrawal(token, req.body.reason);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);
