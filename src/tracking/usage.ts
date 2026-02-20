import { logUsage, getRecentCalls } from "../db/sqlite.js";
import { PlatformConfig } from "../config.js";

export function trackUsage(
  userId: string,
  tool: string,
  server: string,
  durationMs: number,
  inputSize: number,
  outputSize: number,
  success: boolean,
  error?: string
) {
  logUsage(userId, tool, server, durationMs, inputSize, outputSize, success, error);
}

export function checkRateLimit(userId: string, config: PlatformConfig): boolean {
  const limit = config.rate_limits.default;
  const recent = getRecentCalls(userId, 1);
  return recent < limit;
}
