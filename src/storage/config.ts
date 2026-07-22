import fs from "node:fs";
import type { LlmConfig, Profile } from "../core/types.js";
import { DEFAULT_PROFILE } from "../core/types.js";
import { ensureDirs } from "./paths.js";

export interface FormbaneConfig {
  llm: LlmConfig;
  defaultPolicy: string;
}

export const DEFAULT_LLM: LlmConfig = {
  enabled: false,
  baseUrl: "https://api.openai.com",
  apiKey: "",
  model: "gpt-4o-mini",
  timeoutMs: 60_000,
};

export const DEFAULT_CONFIG: FormbaneConfig = {
  llm: { ...DEFAULT_LLM },
  defaultPolicy: "i-dont-care",
};

export function loadConfig(): FormbaneConfig {
  const { configPath } = ensureDirs();
  if (!fs.existsSync(configPath)) {
    return structuredClone(DEFAULT_CONFIG);
  }
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as Partial<FormbaneConfig>;
    return {
      defaultPolicy: raw.defaultPolicy ?? DEFAULT_CONFIG.defaultPolicy,
      llm: { ...DEFAULT_LLM, ...(raw.llm ?? {}) },
    };
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

export function saveConfig(cfg: FormbaneConfig): void {
  const { configPath } = ensureDirs();
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
}

export function loadProfile(): Profile {
  const { profilePath } = ensureDirs();
  if (!fs.existsSync(profilePath)) {
    return structuredClone(DEFAULT_PROFILE);
  }
  try {
    return JSON.parse(fs.readFileSync(profilePath, "utf8")) as Profile;
  } catch {
    return structuredClone(DEFAULT_PROFILE);
  }
}

export function saveProfile(profile: Profile): void {
  const { profilePath } = ensureDirs();
  fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2));
}

export function resolveLlmFromEnv(cfg: FormbaneConfig): LlmConfig {
  const baseUrl =
    process.env.FORMBANE_LLM_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    cfg.llm.baseUrl;
  const apiKey =
    process.env.FORMBANE_LLM_API_KEY ||
    process.env.OPENAI_API_KEY ||
    cfg.llm.apiKey;
  const model =
    process.env.FORMBANE_LLM_MODEL ||
    process.env.OPENAI_MODEL ||
    cfg.llm.model;
  const enabled =
    process.env.FORMBANE_LLM_ENABLED === "1" ||
    process.env.FORMBANE_LLM_ENABLED === "true" ||
    (cfg.llm.enabled && Boolean(apiKey));
  return {
    enabled: Boolean(enabled && apiKey),
    baseUrl: baseUrl.replace(/\/$/, ""),
    apiKey,
    model,
    timeoutMs: cfg.llm.timeoutMs,
  };
}
