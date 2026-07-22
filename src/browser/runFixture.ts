import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BrowserContext, Page } from "playwright";
import { planAnswers } from "../core/planner.js";
import { resolvePolicy } from "../core/policy.js";
import type { Profile } from "../core/types.js";
import { DEFAULT_PROFILE } from "../core/types.js";
import { fillPlan, validatePage, clickAction } from "./filler.js";
import { launchBrowser } from "./launch.js";
import { saveReceipt } from "./receipt.js";
import { scanForm } from "./scanner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function fixturesDir(): string {
  return path.resolve(__dirname, "../../fixtures/forms");
}

export async function serveFixtures(
  root = fixturesDir(),
  port = 0,
): Promise<{ server: http.Server; baseUrl: string; port: number }> {
  const server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0] || "/");
    const rel = urlPath === "/" ? "/simple.html" : urlPath;
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root)) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const ext = path.extname(file);
    const type =
      ext === ".html"
        ? "text/html; charset=utf-8"
        : ext === ".js"
          ? "text/javascript"
          : "text/plain";
    res.writeHead(200, { "Content-Type": type });
    res.end(fs.readFileSync(file));
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  return { server, baseUrl, port: addr.port };
}

export interface FixtureRunResult {
  schema: Awaited<ReturnType<typeof scanForm>>;
  plan: ReturnType<typeof planAnswers>;
  fill?: Awaited<ReturnType<typeof fillPlan>>;
  validation?: Awaited<ReturnType<typeof validatePage>>;
  receiptDir?: string;
  baseUrl: string;
}

export async function runFixtureFlow(opts: {
  fixture?: string;
  policy?: string;
  profile?: Profile;
  headless?: boolean;
  fill?: boolean;
  submit?: boolean;
  receiptDir?: string;
  profileDir?: string;
}): Promise<FixtureRunResult> {
  const fixture = opts.fixture ?? "simple.html";
  const { server, baseUrl } = await serveFixtures();
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    const launched = await launchBrowser({
      headless: opts.headless ?? true,
      profileDir: opts.profileDir,
    });
    context = launched.context;
    page = launched.page;

    await page.goto(`${baseUrl}/${fixture}`, { waitUntil: "domcontentloaded" });
    let schema = await scanForm(page, 0);
    const policy = resolvePolicy(opts.policy ?? "i-dont-care");
    const profile = opts.profile ?? DEFAULT_PROFILE;
    let plan = planAnswers({ schema, profile, policy, seed: 42 });

    let fill;
    let validation;

    if (opts.fill !== false) {
      // multi-page loop
      for (let pageIdx = 0; pageIdx < 5; pageIdx++) {
        fill = await fillPlan(page, schema, plan);
        validation = await validatePage(page);

        const hasNext = schema.actions.next && schema.actions.next.length > 0;
        if (hasNext && pageIdx < 4) {
          const clicked = await clickAction(page, schema.actions.next, /next|continue/i);
          if (!clicked) break;
          await page.waitForTimeout(200);
          schema = await scanForm(page, pageIdx + 1);
          plan = planAnswers({
            schema,
            profile,
            policy,
            sessionId: plan.session_id,
            persona: plan.persona,
            seed: 42,
          });
        } else {
          break;
        }
      }

      if (opts.submit) {
        await clickAction(page, schema.actions.submit, /submit|send|finish/i);
        await page.waitForTimeout(150);
      }
    }

    let receiptDir: string | undefined;
    if (opts.receiptDir || opts.fill !== false) {
      const meta = await saveReceipt({
        page,
        schema,
        plan,
        policyName: opts.policy ?? "i-dont-care",
        fillResult: fill,
        outDir: opts.receiptDir,
      });
      receiptDir = meta.dir;
    }

    return { schema, plan, fill, validation, receiptDir, baseUrl };
  } finally {
    if (context) await context.close().catch(() => {});
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
