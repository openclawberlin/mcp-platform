import fs from "fs";
import yaml from "js-yaml";
import path from "path";

export interface ServerConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
  pricing: { default: number; [tool: string]: number };
}

export interface PlatformConfig {
  platform: { name: string; port: number };
  auth: { type: string };
  servers: Record<string, ServerConfig>;
  billing: { currency: string; default_credits: number };
  rate_limits: { default: number; [key: string]: number };
}

export function loadConfig(configPath?: string): PlatformConfig {
  const p = configPath || path.join(process.cwd(), "gateway.config.yaml");
  let raw = fs.readFileSync(p, "utf-8");
  // Replace ${ENV_VAR} placeholders with actual environment variables
  raw = raw.replace(/\$\{(\w+)\}/g, (_, key) => process.env[key] || "");
  return yaml.load(raw) as PlatformConfig;
}
