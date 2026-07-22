import { z } from "zod";
import type { LlmConfig } from "../core/types.js";

export interface LlmModel {
  id: string;
  object?: string;
  owned_by?: string;
  created?: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Normalize base URL so we can append /v1/models and /v1/chat/completions.
 * Accepts either https://host or https://host/v1
 */
export function normalizeBaseUrl(baseUrl: string): string {
  let u = baseUrl.trim().replace(/\/$/, "");
  if (u.endsWith("/v1")) {
    u = u.slice(0, -3);
  }
  return u;
}

export function modelsUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/v1/models`;
}

export function chatCompletionsUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/v1/chat/completions`;
}

const ModelsResponseSchema = z.object({
  data: z
    .array(
      z
        .object({
          id: z.string(),
          object: z.string().optional(),
          owned_by: z.string().optional(),
          created: z.number().optional(),
        })
        .passthrough(),
    )
    .default([]),
  object: z.string().optional(),
});

/**
 * OpenAI-compatible LLM client with custom base URL + API key.
 */
export class LlmClient {
  readonly config: LlmConfig;

  constructor(config: LlmConfig) {
    this.config = {
      ...config,
      baseUrl: normalizeBaseUrl(config.baseUrl),
    };
  }

  get enabled(): boolean {
    return this.config.enabled && Boolean(this.config.apiKey);
  }

  /** GET {base}/v1/models */
  async listModels(fetchImpl: typeof fetch = fetch): Promise<LlmModel[]> {
    const url = modelsUrl(this.config.baseUrl);
    const res = await fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`listModels failed ${res.status}: ${body.slice(0, 200)}`);
    }
    const json: unknown = await res.json();
    const parsed = ModelsResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(`Invalid models response: ${parsed.error.message}`);
    }
    return parsed.data.data.map((m) => ({
      id: m.id,
      object: m.object,
      owned_by: m.owned_by,
      created: m.created,
    }));
  }

  /** POST {base}/v1/chat/completions — returns assistant text content */
  async chat(
    messages: ChatMessage[],
    opts: { model?: string; temperature?: number; responseFormat?: "json_object" | "text" } = {},
    fetchImpl: typeof fetch = fetch,
  ): Promise<string> {
    const url = chatCompletionsUrl(this.config.baseUrl);
    const body: Record<string, unknown> = {
      model: opts.model ?? this.config.model,
      messages,
      temperature: opts.temperature ?? 0.2,
    };
    if (opts.responseFormat === "json_object") {
      body.response_format = { type: "json_object" };
    }
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`chat failed ${res.status}: ${t.slice(0, 300)}`);
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("chat response missing choices[0].message.content");
    }
    return content;
  }
}

/** Redact obvious PII-looking values before sending labels to LLM */
export function redactForLlm(text: string): string {
  return text
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "<EMAIL>")
    .replace(/\b\+?\d[\d\s().-]{7,}\d\b/g, "<PHONE>")
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "<SSN>")
    .replace(/\b\d{16}\b/g, "<CARD>");
}

export function createDisabledClient(): LlmClient {
  return new LlmClient({
    enabled: false,
    baseUrl: "http://127.0.0.1:0",
    apiKey: "",
    model: "",
    timeoutMs: 1000,
  });
}
