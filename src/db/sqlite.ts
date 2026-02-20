import Database from "better-sqlite3";
import path from "path";

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(path.join(process.cwd(), "platform.db"));
    db.pragma("journal_mode = WAL");
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      key TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now')),
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS usage_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      tool TEXT NOT NULL,
      server TEXT NOT NULL,
      timestamp TEXT DEFAULT (datetime('now')),
      duration_ms INTEGER,
      input_size INTEGER,
      output_size INTEGER,
      success INTEGER DEFAULT 1,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS billing (
      user_id TEXT PRIMARY KEY REFERENCES users(id),
      balance REAL DEFAULT 0,
      total_spent REAL DEFAULT 0
    );
  `);
}

export function ensureUser(userId: string, name: string, defaultCredits: number) {
  const d = getDb();
  const existing = d.prepare("SELECT id FROM users WHERE id = ?").get(userId);
  if (!existing) {
    d.prepare("INSERT INTO users (id, name) VALUES (?, ?)").run(userId, name);
    d.prepare("INSERT INTO billing (user_id, balance, total_spent) VALUES (?, ?, 0)").run(userId, defaultCredits);
  }
}

export function createApiKey(userId: string, key: string) {
  getDb().prepare("INSERT INTO api_keys (key, user_id) VALUES (?, ?)").run(key, userId);
}

export function getUserByApiKey(key: string): { id: string; name: string } | undefined {
  return getDb().prepare(
    "SELECT u.id, u.name FROM users u JOIN api_keys ak ON u.id = ak.user_id WHERE ak.key = ? AND ak.active = 1"
  ).get(key) as { id: string; name: string } | undefined;
}

export function logUsage(userId: string, tool: string, server: string, durationMs: number, inputSize: number, outputSize: number, success: boolean, error?: string) {
  getDb().prepare(
    "INSERT INTO usage_log (user_id, tool, server, duration_ms, input_size, output_size, success, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(userId, tool, server, durationMs, inputSize, outputSize, success ? 1 : 0, error || null);
}

export function getBalance(userId: string): { balance: number; total_spent: number } {
  return getDb().prepare("SELECT balance, total_spent FROM billing WHERE user_id = ?").get(userId) as { balance: number; total_spent: number } || { balance: 0, total_spent: 0 };
}

export function deductBalance(userId: string, amount: number) {
  getDb().prepare("UPDATE billing SET balance = balance - ?, total_spent = total_spent + ? WHERE user_id = ?").run(amount, amount, userId);
}

export function addCredits(userId: string, amount: number) {
  getDb().prepare("UPDATE billing SET balance = balance + ? WHERE user_id = ?").run(amount, userId);
}

export function getUsageSummary(userId: string) {
  return getDb().prepare(
    "SELECT server, tool, COUNT(*) as calls, SUM(duration_ms) as total_duration_ms FROM usage_log WHERE user_id = ? GROUP BY server, tool"
  ).all(userId);
}

export function getUsageByTool(userId: string) {
  return getDb().prepare(
    "SELECT tool, COUNT(*) as calls, SUM(duration_ms) as total_duration_ms, SUM(input_size) as total_input, SUM(output_size) as total_output, SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as errors FROM usage_log WHERE user_id = ? GROUP BY tool"
  ).all(userId);
}

export function getRecentUsage(limit: number = 50) {
  return getDb().prepare(
    "SELECT * FROM usage_log ORDER BY timestamp DESC LIMIT ?"
  ).all(limit);
}

export function getAllUsers() {
  return getDb().prepare(
    "SELECT u.id, u.name, u.created_at, b.balance, b.total_spent, (SELECT COUNT(*) FROM usage_log WHERE user_id = u.id) as total_calls FROM users u LEFT JOIN billing b ON u.id = b.user_id"
  ).all();
}

export function getRecentCalls(userId: string, minutes: number = 1): number {
  return (getDb().prepare(
    "SELECT COUNT(*) as cnt FROM usage_log WHERE user_id = ? AND timestamp > datetime('now', ?)"
  ).get(userId, `-${minutes} minutes`) as { cnt: number }).cnt;
}
