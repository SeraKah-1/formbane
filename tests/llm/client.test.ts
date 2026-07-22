import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  LlmClient,
  modelsUrl,
  chatCompletionsUrl,
  normalizeBaseUrl,
  redactForLlm,
} from "../../src/llm/client.js";

async function withMockServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void,
  fn: (base: string) => Promise<void>,
) {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => handler(req, res, Buffer.concat(chunks).toString("utf8")));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no addr");
  const base = `http://127.0.0.1:${addr.port}`;
  try {
    await fn(base);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

describe("LLM URL helpers", () => {
  it("normalizes base with or without /v1", () => {
    assert.equal(normalizeBaseUrl("https://api.example.com/v1/"), "https://api.example.com");
    assert.equal(normalizeBaseUrl("https://api.example.com"), "https://api.example.com");
    assert.equal(modelsUrl("https://api.example.com/v1"), "https://api.example.com/v1/models");
    assert.equal(
      chatCompletionsUrl("http://localhost:11434"),
      "http://localhost:11434/v1/chat/completions",
    );
  });

  it("redacts email and phone", () => {
    const r = redactForLlm("Contact me at a@b.com or +1 555-123-4567");
    assert.ok(r.includes("<EMAIL>"));
    assert.ok(r.includes("<PHONE>"));
    assert.ok(!r.includes("a@b.com"));
  });
});

describe("LlmClient against mock OpenAI-compatible server", () => {
  it("lists models via GET /v1/models with Authorization header", async () => {
    let sawAuth = "";
    let sawPath = "";
    await withMockServer((req, res) => {
      sawPath = req.url || "";
      sawAuth = String(req.headers.authorization || "");
      if (req.method === "GET" && req.url === "/v1/models") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            object: "list",
            data: [
              { id: "gpt-test", object: "model", owned_by: "mock" },
              { id: "local-model", object: "model", owned_by: "local" },
            ],
          }),
        );
        return;
      }
      res.writeHead(404);
      res.end("no");
    }, async (base) => {
      const client = new LlmClient({
        enabled: true,
        baseUrl: base,
        apiKey: "sk-test-key",
        model: "gpt-test",
        timeoutMs: 5000,
      });
      const models = await client.listModels();
      assert.equal(sawPath, "/v1/models");
      assert.equal(sawAuth, "Bearer sk-test-key");
      assert.equal(models.length, 2);
      assert.equal(models[0]!.id, "gpt-test");
      assert.equal(models[1]!.id, "local-model");
    });
  });

  it("uses custom base URL path for chat completions", async () => {
    let sawPath = "";
    let body = "";
    await withMockServer((req, res, b) => {
      sawPath = req.url || "";
      body = b;
      if (req.method === "POST" && req.url === "/v1/chat/completions") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: '{"ok":true}' } }],
          }),
        );
        return;
      }
      res.writeHead(404);
      res.end();
    }, async (base) => {
      const client = new LlmClient({
        enabled: true,
        baseUrl: `${base}/v1`,
        apiKey: "k",
        model: "m1",
        timeoutMs: 5000,
      });
      const content = await client.chat([{ role: "user", content: "hi" }], {
        responseFormat: "json_object",
      });
      assert.equal(sawPath, "/v1/chat/completions");
      assert.equal(content, '{"ok":true}');
      const parsed = JSON.parse(body);
      assert.equal(parsed.model, "m1");
      assert.equal(parsed.response_format.type, "json_object");
    });
  });

  it("disabled client reports not enabled", () => {
    const client = new LlmClient({
      enabled: false,
      baseUrl: "http://127.0.0.1:9",
      apiKey: "",
      model: "x",
      timeoutMs: 1000,
    });
    assert.equal(client.enabled, false);
  });
});
