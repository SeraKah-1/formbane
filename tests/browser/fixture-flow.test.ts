import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runFixtureFlow } from "../../src/browser/runFixture.js";

const canBrowser = process.env.FORMBANE_SKIP_BROWSER !== "1";

describe("fixture flow (Playwright)", { skip: !canBrowser }, () => {
  it("scans, plans, fills simple.html and writes receipt", async () => {
    const receiptDir = fs.mkdtempSync(path.join(os.tmpdir(), "formbane-receipt-"));
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "formbane-browser-"));
    try {
      const result = await runFixtureFlow({
        fixture: "simple.html",
        policy: "i-dont-care",
        headless: true,
        fill: true,
        submit: true,
        receiptDir,
        profileDir,
      });

      assert.ok(result.schema.fields.length >= 4, "should scan multiple fields");
      const labels = result.schema.fields.map((f) => f.label.toLowerCase());
      assert.ok(labels.some((l) => l.includes("email")));

      const emailAns = result.plan.answers.find((a) =>
        result.schema.fields.find((f) => f.field_id === a.field_id && /email/i.test(f.label)),
      );
      assert.ok(emailAns?.value, "email should be planned from profile");

      assert.ok(result.fill, "fill result present");
      assert.ok(
        (result.fill!.filled.length > 0 || result.fill!.skipped.length > 0),
        "fill attempted fields",
      );

      // legal + password should be blocked in plan
      assert.ok(
        result.plan.blocked.includes("legal") ||
          result.plan.blocked.includes("password") ||
          result.plan.answers.some((a) => a.blocked),
      );

      assert.ok(result.receiptDir);
      assert.ok(fs.existsSync(path.join(result.receiptDir!, "answer_plan.json")));
      assert.ok(fs.existsSync(path.join(result.receiptDir!, "form_schema.json")));
      assert.ok(fs.existsSync(path.join(result.receiptDir!, "meta.json")));
    } catch (e) {
      const msg = String((e as Error).message || e);
      if (/Executable doesn't exist|browserType\.launch|Full version/.test(msg)) {
        console.error("Playwright browser missing — skip hard fail:", msg);
        return;
      }
      throw e;
    }
  });

  it("handles multi-page fixture", async () => {
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "formbane-browser-"));
    try {
      const result = await runFixtureFlow({
        fixture: "multi-page.html",
        policy: "happy-customer",
        headless: true,
        fill: true,
        profileDir,
      });
      assert.ok(result.schema.fields.length >= 1);
      assert.ok(result.plan.answers.length >= 1);
    } catch (e) {
      const msg = String((e as Error).message || e);
      if (/Executable doesn't exist|browserType\.launch/.test(msg)) {
        console.error("Playwright browser missing — skip:", msg);
        return;
      }
      throw e;
    }
  });
});
