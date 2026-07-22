import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanHtml, fillHtml } from "../../src/browser/scanHtml.js";
import { planAnswers } from "../../src/core/planner.js";
import { resolvePolicy } from "../../src/core/policy.js";
import { DEFAULT_PROFILE } from "../../src/core/types.js";

const fixtures = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/forms",
);

describe("offline fixture scan + plan + fill", () => {
  it("scans simple.html into structured fields and plans neutral answers", () => {
    const html = fs.readFileSync(path.join(fixtures, "simple.html"), "utf8");
    const schema = scanHtml(html, { url: "file://simple.html" });
    assert.ok(schema.fields.length >= 5);
    const email = schema.fields.find((f) => /email/i.test(f.label));
    assert.ok(email);
    assert.equal(email!.type, "email");

    const sat = schema.fields.find((f) => /satisfied/i.test(f.label));
    assert.ok(sat);
    assert.ok(sat!.options.length >= 3);

    const legal = schema.fields.find((f) => /perjury|certify/i.test(f.label));
    assert.ok(legal);
    assert.equal(legal!.semantic_kind, "legal_attestation");

    const plan = planAnswers({
      schema,
      profile: DEFAULT_PROFILE,
      policy: resolvePolicy("i-dont-care"),
      seed: 42,
    });

    const emailAns = plan.answers.find((a) => a.field_id === email!.field_id);
    assert.equal(emailAns?.value, DEFAULT_PROFILE.identity.email);
    assert.equal(emailAns?.source, "profile");

    const legalAns = plan.answers.find((a) => a.field_id === legal!.field_id);
    assert.equal(legalAns?.blocked, true);

    const filled = fillHtml(html, plan, schema);
    assert.match(filled, new RegExp(String(DEFAULT_PROFILE.identity.email).replace(".", "\\.")));
    // password must not be inventively filled with a secret
    assert.ok(!/type="password"[^>]*value="[^"]+"/.test(filled) || /type="password"/.test(filled));
  });

  it("happy-customer picks high satisfaction on fixture options", () => {
    const html = fs.readFileSync(path.join(fixtures, "simple.html"), "utf8");
    const schema = scanHtml(html);
    const plan = planAnswers({
      schema,
      profile: DEFAULT_PROFILE,
      policy: resolvePolicy("happy-customer"),
      seed: 1,
    });
    const sat = schema.fields.find((f) => /satisfied/i.test(f.label));
    assert.ok(sat);
    const ans = plan.answers.find((a) => a.field_id === sat!.field_id);
    assert.equal(ans?.value, "5");
  });
});
