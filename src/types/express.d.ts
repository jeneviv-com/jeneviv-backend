import type { Merchant } from "../db/schema/merchants.js";
import type { User } from "../db/schema/auth.js";

declare global {
  namespace Express {
    interface Request {
      user?: User;
      sessionId?: string;
      merchant?: Merchant;
    }
  }
}

export {};
