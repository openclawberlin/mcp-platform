import { getBalance, deductBalance, addCredits as dbAddCredits } from "../db/sqlite.js";
import { PlatformConfig, ServerConfig } from "../config.js";

export function getToolCost(serverName: string, toolName: string, config: PlatformConfig): number {
  const serverConfig = config.servers[serverName];
  if (!serverConfig) return 0;
  return serverConfig.pricing[toolName] ?? serverConfig.pricing.default ?? 0;
}

export function checkBalance(userId: string, cost: number): boolean {
  const { balance } = getBalance(userId);
  return balance >= cost;
}

export function deductCost(userId: string, cost: number) {
  deductBalance(userId, cost);
}

export function addCredits(userId: string, amount: number) {
  dbAddCredits(userId, amount);
}

export function getBillingStatus(userId: string) {
  return getBalance(userId);
}
