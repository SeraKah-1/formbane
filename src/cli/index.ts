#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { planAnswers } from "../core/planner.js";
import { listPresets, resolvePolicy } from "../core/policy.js";
import { DEFAULT_PROFILE } from "../core/types.js";
import { runFixtureFlow, serveFixtures, fixturesDir } from "../browser/runFixture.js";
import { launchBrowser } from "../browser/launch.js";
import { scanForm } from "../browser/scanner.js";
import { fillPlan, validatePage, clickAction } from "../browser/filler.js";
import { saveReceipt } from "../browser/receipt.js";
import {
  loadConfig,
  loadProfile,
  resolveLlmFromEnv,
  saveConfig,
  saveProfile,
  DEFAULT_CONFIG,
} from "../storage/config.js";
import { ensureDirs } from "../storage/paths.js";
import { LlmClient } from "../llm/client.js";
import { assistFieldMapping } from "../llm/assist.js";

const program = new Command();

program
  .name("formbane")
  .description("Formbane — local form & survey agent (scan → plan → fill → human-gated submit)")
  .version("0.1.0");

program
  .command("init")
  .description("Create ~/.formbane dirs, default profile, and config")
  .action(() => {
    const dirs = ensureDirs();
    const cfg = loadConfig();
    saveConfig(cfg);
    const profile = loadProfile();
    if (!fs.existsSync(dirs.profilePath)) saveProfile(profile);
    console.log(JSON.stringify({ ok: true, home: dirs.home, profile: dirs.profilePath, config: dirs.configPath }, null, 2));
  });

program
  .command("policies")
  .description("List built-in policy presets")
  .action(() => {
    for (const p of listPresets()) console.log(p);
  });

program
  .command("profile")
  .description("Show or write local profile JSON")
  .option("--write <file>", "Replace profile from JSON file")
  .action((opts: { write?: string }) => {
    if (opts.write) {
      const data = JSON.parse(fs.readFileSync(opts.write, "utf8"));
      saveProfile(data);
      console.log("profile saved");
      return;
    }
    console.log(JSON.stringify(loadProfile(), null, 2));
  });

program
  .command("config")
  .description("Show config (LLM endpoint settings)")
  .action(() => {
    const cfg = loadConfig();
    const llm = resolveLlmFromEnv(cfg);
    console.log(
      JSON.stringify(
        {
          ...cfg,
          llm: { ...llm, apiKey: llm.apiKey ? "***" : "" },
        },
        null,
        2,
      ),
    );
  });

program
  .command("llm")
  .description("Configure or probe OpenAI-compatible LLM")
  .option("--base-url <url>", "Custom API base (e.g. https://api.openai.com or http://localhost:11434)")
  .option("--api-key <key>", "API key")
  .option("--model <id>", "Model id")
  .option("--enable", "Enable LLM assist")
  .option("--disable", "Disable LLM assist")
  .option("--list-models", "GET {base}/v1/models")
  .action(async (opts: {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    enable?: boolean;
    disable?: boolean;
    listModels?: boolean;
  }) => {
    const cfg = loadConfig();
    if (opts.baseUrl) cfg.llm.baseUrl = opts.baseUrl;
    if (opts.apiKey) cfg.llm.apiKey = opts.apiKey;
    if (opts.model) cfg.llm.model = opts.model;
    if (opts.enable) cfg.llm.enabled = true;
    if (opts.disable) cfg.llm.enabled = false;
    if (opts.baseUrl || opts.apiKey || opts.model || opts.enable || opts.disable) {
      saveConfig(cfg);
      console.log("config saved");
    }
    const llm = resolveLlmFromEnv(cfg);
    if (opts.listModels) {
      if (!llm.apiKey) {
        console.error("No API key. Set --api-key or FORMBANE_LLM_API_KEY / OPENAI_API_KEY");
        process.exitCode = 1;
        return;
      }
      const client = new LlmClient({ ...llm, enabled: true });
      const models = await client.listModels();
      console.log(JSON.stringify(models, null, 2));
      return;
    }
    console.log(
      JSON.stringify(
        { llm: { ...llm, apiKey: llm.apiKey ? "***" : "" } },
        null,
        2,
      ),
    );
  });

program
  .command("plan")
  .description("Plan answers for a FormSchema JSON file (no browser)")
  .requiredOption("--schema <file>", "Path to form schema JSON")
  .option("--policy <name>", "Policy preset", "i-dont-care")
  .option("--seed <n>", "Persona seed", "42")
  .option("--out <file>", "Write plan JSON")
  .action((opts: { schema: string; policy: string; seed: string; out?: string }) => {
    const schema = JSON.parse(fs.readFileSync(opts.schema, "utf8"));
    const policy = resolvePolicy(opts.policy);
    const profile = loadProfile();
    const plan = planAnswers({
      schema,
      profile,
      policy,
      seed: Number(opts.seed) || 42,
    });
    const text = JSON.stringify(plan, null, 2);
    if (opts.out) fs.writeFileSync(opts.out, text);
    console.log(text);
  });

program
  .command("fixture")
  .description("Run against a local HTML fixture (scan/plan/fill/receipt)")
  .argument("[name]", "Fixture filename", "simple.html")
  .option("--policy <name>", "Policy preset", "i-dont-care")
  .option("--no-fill", "Scan + plan only")
  .option("--submit", "Click submit after fill")
  .option("--headed", "Show browser")
  .option("--offline", "Parse HTML without Playwright (CI-safe)")
  .option("--receipt-dir <dir>", "Receipt output directory")
  .action(
    async (
      name: string,
      opts: {
        policy: string;
        fill?: boolean;
        submit?: boolean;
        headed?: boolean;
        offline?: boolean;
        receiptDir?: string;
      },
    ) => {
      if (opts.offline) {
        const { scanHtml, fillHtml } = await import("../browser/scanHtml.js");
        const { saveReceipt } = await import("../browser/receipt.js");
        const file = path.join(fixturesDir(), name);
        const html = fs.readFileSync(file, "utf8");
        const schema = scanHtml(html, {
          url: `file://${file}`,
          page_title: undefined,
        });
        const policy = resolvePolicy(opts.policy);
        const profile = loadProfile();
        const plan = planAnswers({ schema, profile, policy, seed: 42 });
        let filledHtml: string | undefined;
        if (opts.fill !== false) {
          filledHtml = fillHtml(html, plan, schema);
        }
        const receipt = await saveReceipt({
          page: null,
          schema,
          plan,
          policyName: opts.policy,
          fillResult: filledHtml
            ? { mode: "offline", bytes: filledHtml.length }
            : undefined,
          outDir: opts.receiptDir,
        });
        if (filledHtml && opts.receiptDir) {
          fs.writeFileSync(path.join(receipt.dir, "filled.html"), filledHtml);
        }
        console.log(
          JSON.stringify(
            {
              mode: "offline",
              url: schema.url,
              title: schema.page_title,
              form_class: schema.form_class,
              fields: schema.fields.map((f) => ({
                id: f.field_id,
                label: f.label,
                type: f.type,
                kind: f.semantic_kind,
                required: f.required,
              })),
              plan: {
                session_id: plan.session_id,
                answers: plan.answers.map((a) => ({
                  field_id: a.field_id,
                  value: a.value,
                  source: a.source,
                  skip: a.skip,
                  blocked: a.blocked,
                  ask_user: a.ask_user,
                })),
                questions_for_user: plan.questions_for_user.length,
                warnings: plan.warnings,
                blocked: plan.blocked,
              },
              receiptDir: receipt.dir,
            },
            null,
            2,
          ),
        );
        return;
      }

      const result = await runFixtureFlow({
        fixture: name,
        policy: opts.policy,
        fill: opts.fill !== false,
        submit: Boolean(opts.submit),
        headless: !opts.headed,
        receiptDir: opts.receiptDir,
      });
      console.log(
        JSON.stringify(
          {
            url: result.schema.url,
            title: result.schema.page_title,
            form_class: result.schema.form_class,
            fields: result.schema.fields.map((f) => ({
              id: f.field_id,
              label: f.label,
              type: f.type,
              kind: f.semantic_kind,
              required: f.required,
            })),
            plan: {
              session_id: result.plan.session_id,
              answers: result.plan.answers.map((a) => ({
                field_id: a.field_id,
                value: a.value,
                source: a.source,
                skip: a.skip,
                blocked: a.blocked,
                ask_user: a.ask_user,
              })),
              questions_for_user: result.plan.questions_for_user.length,
              warnings: result.plan.warnings,
              blocked: result.plan.blocked,
            },
            fill: result.fill,
            validation: result.validation,
            receiptDir: result.receiptDir,
          },
          null,
          2,
        ),
      );
    },
  );

program
  .command("run")
  .description("Open a URL, scan, plan, fill, and write a receipt (human gates respected)")
  .argument("<url>", "Target form URL")
  .option("--policy <name>", "Policy preset", "i-dont-care")
  .option("--headed", "Show browser (default true unless FORMBANE_HEADLESS=1)")
  .option("--headless", "Force headless")
  .option("--no-fill", "Scan + plan only")
  .option("--submit", "Attempt submit after review token (requires --yes)")
  .option("--yes", "Confirm submit for low-risk survey class only")
  .option("--receipt-dir <dir>", "Receipt directory")
  .action(
    async (
      url: string,
      opts: {
        policy: string;
        headed?: boolean;
        headless?: boolean;
        fill?: boolean;
        submit?: boolean;
        yes?: boolean;
        receiptDir?: string;
      },
    ) => {
      const { context, page } = await launchBrowser({
        headless: Boolean(opts.headless) || (!opts.headed && process.env.FORMBANE_HEADLESS === "1"),
      });
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
        const schema = await scanForm(page, 0);
        const policy = resolvePolicy(opts.policy);
        const profile = loadProfile();
        let plan = planAnswers({ schema, profile, policy, seed: 42 });

        // optional LLM assist (does not invent official facts)
        const llmCfg = resolveLlmFromEnv(loadConfig());
        if (llmCfg.enabled) {
          try {
            const client = new LlmClient(llmCfg);
            const assist = await assistFieldMapping(client, schema.fields);
            if (assist.length) {
              console.error(`LLM assist mappings: ${assist.length}`);
            }
          } catch (e) {
            console.error(`LLM assist skipped: ${(e as Error).message}`);
          }
        }

        let fill;
        if (opts.fill !== false) {
          fill = await fillPlan(page, schema, plan);
        }
        const validation = await validatePage(page);

        if (opts.submit) {
          const canAuto =
            policy.allow_auto_submit ||
            (opts.yes &&
              (schema.form_class === "survey_junk" || schema.form_class === "csat") &&
              plan.blocked.length === 0);
          if (!canAuto) {
            console.error(
              "Submit blocked: need human review. Use review of plan + --yes only for low-risk surveys. Legal/payment/password always blocked.",
            );
          } else {
            await clickAction(page, schema.actions.submit, /submit|send|finish/i);
          }
        }

        const receipt = await saveReceipt({
          page,
          schema,
          plan,
          policyName: opts.policy,
          fillResult: fill,
          outDir: opts.receiptDir,
        });

        console.log(
          JSON.stringify(
            {
              schema: {
                url: schema.url,
                title: schema.page_title,
                form_class: schema.form_class,
                field_count: schema.fields.length,
                fields: schema.fields.map((f) => ({
                  id: f.field_id,
                  label: f.label,
                  type: f.type,
                  kind: f.semantic_kind,
                })),
              },
              plan: {
                answers: plan.answers,
                questions_for_user: plan.questions_for_user,
                warnings: plan.warnings,
                blocked: plan.blocked,
              },
              fill,
              validation,
              receiptDir: receipt.dir,
            },
            null,
            2,
          ),
        );
      } finally {
        await context.close();
      }
    },
  );

program
  .command("serve-fixtures")
  .description("Serve local HTML fixtures on 127.0.0.1")
  .option("--port <n>", "Port", "8765")
  .action(async (opts: { port: string }) => {
    const { baseUrl } = await serveFixtures(fixturesDir(), Number(opts.port) || 8765);
    console.log(`Fixtures at ${baseUrl}/simple.html`);
    console.log("Press Ctrl+C to stop");
    await new Promise(() => {});
  });

// ensure default config exists on any command
ensureDirs();
if (!fs.existsSync(ensureDirs().configPath)) saveConfig(DEFAULT_CONFIG);
if (!fs.existsSync(ensureDirs().profilePath)) saveProfile(DEFAULT_PROFILE);

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
