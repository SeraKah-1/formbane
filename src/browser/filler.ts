import type { Page } from "playwright";
import type { AnswerPlan, Field, FormSchema } from "../core/types.js";

export interface FillResult {
  filled: string[];
  skipped: string[];
  blocked: string[];
  errors: string[];
}

async function setNativeValue(page: Page, selector: string, value: string): Promise<boolean> {
  return page.evaluate(
    ({ selector, value }) => {
      const el = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
      if (!el) return false;
      el.focus();
      const proto =
        el.tagName === "TEXTAREA"
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, "value");
      if (desc?.set) {
        desc.set.call(el, value);
      } else {
        el.value = value;
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.blur();
      return true;
    },
    { selector, value },
  );
}

function firstSelector(field: Field): string | null {
  return field.selector_candidates.find((s) => !s.startsWith("label=")) ?? null;
}

export async function fillPlan(
  page: Page,
  schema: FormSchema,
  plan: AnswerPlan,
): Promise<FillResult> {
  const byId = new Map(schema.fields.map((f) => [f.field_id, f]));
  const result: FillResult = { filled: [], skipped: [], blocked: [], errors: [] };

  for (const ans of plan.answers) {
    const field = byId.get(ans.field_id);
    if (!field) {
      result.errors.push(`unknown field ${ans.field_id}`);
      continue;
    }
    if (ans.skip || ans.value == null || ans.value === "") {
      result.skipped.push(field.field_id);
      continue;
    }
    if (ans.blocked) {
      result.blocked.push(field.field_id);
      continue;
    }
    if (
      field.type === "password" ||
      field.semantic_kind === "credential" ||
      field.semantic_kind === "payment" ||
      field.semantic_kind === "honeypot"
    ) {
      result.blocked.push(field.field_id);
      continue;
    }
    if (field.semantic_kind === "legal_attestation" && ans.source !== "user") {
      result.blocked.push(field.field_id);
      continue;
    }

    const sel = firstSelector(field);
    if (!sel) {
      result.errors.push(`no selector for ${field.label}`);
      continue;
    }

    try {
      if (field.type === "select") {
        await page.selectOption(sel, String(ans.value)).catch(async () => {
          await page.selectOption(sel, { label: String(ans.value) });
        });
        result.filled.push(field.field_id);
        continue;
      }

      if (field.type === "radio") {
        const name = field.name;
        if (name) {
          const radioSel = `input[type=radio][name="${name}"][value="${String(ans.value).replace(/"/g, '\\"')}"]`;
          const alt = page.locator(`input[type=radio][name="${name}"]`).filter({
            has: page.locator(`xpath=..//*[contains(normalize-space(.), "${String(ans.value)}")]`),
          });
          if (await page.locator(radioSel).count()) {
            await page.locator(radioSel).first().check({ force: true });
          } else {
            // match by label text near radio
            const all = page.locator(`input[type=radio][name="${name}"]`);
            const count = await all.count();
            let clicked = false;
            for (let i = 0; i < count; i++) {
              const r = all.nth(i);
              const val = await r.getAttribute("value");
              const id = await r.getAttribute("id");
              let lab = "";
              if (id) {
                lab = (await page.locator(`label[for="${id}"]`).textContent().catch(() => "")) ?? "";
              }
              if (val === String(ans.value) || lab.trim() === String(ans.value) || lab.includes(String(ans.value))) {
                await r.check({ force: true });
                clicked = true;
                break;
              }
            }
            if (!clicked) {
              // try option text from schema
              const opt = field.options.find(
                (o) => o.value === ans.value || o.text === ans.value,
              );
              if (opt) {
                const byVal = `input[type=radio][name="${name}"][value="${opt.value}"]`;
                if (await page.locator(byVal).count()) {
                  await page.locator(byVal).first().check({ force: true });
                  clicked = true;
                }
              }
            }
            if (!clicked) throw new Error(`radio not found for ${ans.value}`);
          }
          void alt;
          result.filled.push(field.field_id);
          continue;
        }
      }

      if (field.type === "checkbox") {
        const want = Boolean(ans.value) && ans.value !== "false" && ans.value !== 0;
        const loc = page.locator(sel).first();
        const checked = await loc.isChecked().catch(() => false);
        if (want !== checked) {
          await loc.setChecked(want, { force: true });
        }
        result.filled.push(field.field_id);
        continue;
      }

      // text-like
      const ok = await setNativeValue(page, sel, String(ans.value));
      if (!ok) {
        await page.fill(sel, String(ans.value));
      }
      result.filled.push(field.field_id);
    } catch (e) {
      result.errors.push(`${field.label}: ${(e as Error).message}`);
    }
  }

  return result;
}

export async function validatePage(page: Page): Promise<
  Array<{ name: string; id: string; message: string }>
> {
  return page.evaluate(() => {
    const fields = Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        "input, select, textarea",
      ),
    );
    return fields
      .filter((el) => typeof el.checkValidity === "function" && !el.checkValidity())
      .map((el) => ({
        name: el.name || "",
        id: el.id || "",
        message: el.validationMessage || "invalid",
      }));
  });
}

export async function clickAction(
  page: Page,
  selectors: string[] | undefined,
  fallbackText?: RegExp,
): Promise<boolean> {
  if (selectors) {
    for (const s of selectors) {
      if (s.startsWith("text=")) {
        const t = s.slice(5);
        const loc = page.getByRole("button", { name: t });
        if (await loc.count()) {
          await loc.first().click();
          return true;
        }
      } else {
        const loc = page.locator(s);
        if (await loc.count()) {
          await loc.first().click();
          return true;
        }
      }
    }
  }
  if (fallbackText) {
    const btn = page.getByRole("button", { name: fallbackText });
    if (await btn.count()) {
      await btn.first().click();
      return true;
    }
  }
  return false;
}
