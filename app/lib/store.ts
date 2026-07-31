import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Intent } from "./intent/model";
import { hydrateIntent } from "./intent/model";
import { bigIntReplacer } from "./server/json";

const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), ".data");
const INTENTS_FILE = join(DATA_DIR, "intents.json");

function ensureDir() {
  mkdirSync(DATA_DIR, { recursive: true });
}

function readAll(): Record<string, Intent> {
  ensureDir();
  if (!existsSync(INTENTS_FILE)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(INTENTS_FILE, "utf8")) as Record<string, Intent>;
  } catch {
    return {};
  }
}

function writeAll(data: Record<string, Intent>) {
  ensureDir();
  writeFileSync(INTENTS_FILE, JSON.stringify(data, bigIntReplacer, 2));
}

export async function saveIntent(intent: Intent): Promise<void> {
  const all = readAll();
  all[intent.id] = intent;
  writeAll(all);
}

export async function getIntent(id: string): Promise<Intent | undefined> {
  const raw = readAll()[id];
  return raw ? hydrateIntent(raw as unknown as Record<string, unknown>) : undefined;
}

export async function listIntentsByXrpl(xrplAddress: string): Promise<Intent[]> {
  const all = readAll();
  return Object.values(all)
    .filter((i) => i.xrplAddress.toLowerCase() === xrplAddress.toLowerCase())
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((i) => hydrateIntent(i as unknown as Record<string, unknown>));
}

export async function listActiveIntents(): Promise<Intent[]> {
  return Object.values(readAll())
    .filter((i) => i.status === "active")
    .map((i) => hydrateIntent(i as unknown as Record<string, unknown>));
}
