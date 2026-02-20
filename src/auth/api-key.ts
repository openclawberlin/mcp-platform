import { Request, Response, NextFunction } from "express";
import { getUserByApiKey } from "../db/sqlite.js";

export interface AuthenticatedRequest extends Request {
  userId?: string;
  userName?: string;
}

export function apiKeyAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }
  const key = authHeader.slice(7);
  const user = getUserByApiKey(key);
  if (!user) {
    res.status(401).json({ error: "Invalid API key" });
    return;
  }
  req.userId = user.id;
  req.userName = user.name;
  next();
}
