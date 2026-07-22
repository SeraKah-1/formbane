import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import type { AnswerPlan, FormSchema } from "../core/types.js";
import { ensureDirs } from "../storage/paths.js";

export interface ReceiptMeta {
  created_at: string;
  url: string;
  page_title: string;
  session_id: string;
  policy?: string;
  dir: string;
}

export async function saveReceipt(opts: {
  page?: Page | null;
  schema: FormSchema;
  plan: AnswerPlan;
  policyName?: string;
  fillResult?: unknown;
  outDir?: string;
}): Promise<ReceiptMeta> {
  const { submissions } = ensureDirs();
  const host = (() => {
    try {
      return new URL(opts.schema.url).hostname.replace(/[^\w.-]+/g, "_");
    } catch {
      return "local";
    }
  })();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = opts.outDir ?? path.join(submissions, `${stamp}_${host}`);
  fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(path.join(dir, "form_schema.json"), JSON.stringify(opts.schema, null, 2));
  fs.writeFileSync(path.join(dir, "answer_plan.json"), JSON.stringify(opts.plan, null, 2));
  if (opts.fillResult) {
    fs.writeFileSync(path.join(dir, "fill_result.json"), JSON.stringify(opts.fillResult, null, 2));
  }

  let screenshotPath: string | undefined;
  if (opts.page) {
    const shot = path.join(dir, "confirmation.png");
    try {
      await opts.page.screenshot({ path: shot, fullPage: true });
      screenshotPath = shot;
    } catch {
      screenshotPath = undefined;
    }
  }

  const meta: ReceiptMeta = {
    created_at: new Date().toISOString(),
    url: opts.schema.url,
    page_title: opts.schema.page_title,
    session_id: opts.plan.session_id,
    policy: opts.policyName,
    dir,
  };
  fs.writeFileSync(
    path.join(dir, "meta.json"),
    JSON.stringify({ ...meta, screenshot: screenshotPath }, null, 2),
  );
  fs.writeFileSync(
    path.join(dir, "log.txt"),
    [
      `Formbane receipt`,
      `url: ${meta.url}`,
      `title: ${meta.page_title}`,
      `session: ${meta.session_id}`,
      `policy: ${meta.policy ?? ""}`,
      `answers: ${opts.plan.answers.filter((a) => !a.skip && a.value != null).length}`,
      `blocked: ${opts.plan.blocked.join(", ")}`,
      `warnings: ${opts.plan.warnings.join(" | ")}`,
    ].join("\n"),
  );

  return meta;
}
