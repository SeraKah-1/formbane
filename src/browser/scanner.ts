import type { Page } from "playwright";
import {
  classifyFormClass,
  classifyInputType,
  classifySemantic,
} from "../core/classify.js";
import type { Field, FieldOption, FormSchema } from "../core/types.js";
import { createHash } from "node:crypto";

function fieldId(parts: string[]): string {
  return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 12);
}

interface RawField {
  tag: string;
  type: string;
  name: string;
  id: string;
  label: string;
  placeholder: string;
  autocomplete: string;
  required: boolean;
  disabled: boolean;
  readonly: boolean;
  visible: boolean;
  options: FieldOption[];
  role: string;
  checked?: boolean;
  value?: string;
  selectorHint: string;
}

export async function scanForm(page: Page, pageIndex = 0): Promise<FormSchema> {
  const url = page.url();
  const page_title = await page.title();

  const raw = await page.evaluate(() => {
    function visible(el: Element): boolean {
      const s = window.getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") {
        return false;
      }
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }

    function labelFor(el: HTMLElement): string {
      const id = el.getAttribute("id");
      if (id) {
        const lab = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (lab?.textContent) return lab.textContent.trim();
      }
      const parentLab = el.closest("label");
      if (parentLab?.textContent) {
        const clone = parentLab.cloneNode(true) as HTMLElement;
        clone.querySelectorAll("input,select,textarea").forEach((n) => n.remove());
        const t = clone.textContent?.trim();
        if (t) return t;
      }
      const aria = el.getAttribute("aria-label");
      if (aria) return aria.trim();
      const labelledBy = el.getAttribute("aria-labelledby");
      if (labelledBy) {
        const t = labelledBy
          .split(/\s+/)
          .map((i) => document.getElementById(i)?.textContent?.trim() ?? "")
          .join(" ")
          .trim();
        if (t) return t;
      }
      // nearby text
      const prev = el.previousElementSibling;
      if (prev && prev.textContent && prev.textContent.trim().length < 120) {
        return prev.textContent.trim();
      }
      return el.getAttribute("name") || el.getAttribute("placeholder") || "";
    }

    function optionsOf(el: HTMLElement): { value: string; text: string }[] {
      if (el.tagName === "SELECT") {
        return Array.from((el as HTMLSelectElement).options).map((o) => ({
          value: o.value,
          text: o.textContent?.trim() || o.value,
        }));
      }
      if ((el as HTMLInputElement).type === "radio" || (el as HTMLInputElement).type === "checkbox") {
        return [];
      }
      return [];
    }

    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>(
        "input, select, textarea, [contenteditable='true'], [role='combobox'], [role='radiogroup'] input, [role='checkbox']",
      ),
    );

    const out: Array<Record<string, unknown>> = [];
    const seenRadio = new Set<string>();

    for (const el of nodes) {
      const tag = el.tagName.toLowerCase();
      const input = el as HTMLInputElement;
      const type = (input.type || "").toLowerCase();
      const name = input.name || "";
      const id = el.id || "";
      const role = el.getAttribute("role") || "";

      // group radios by name into one logical field later
      if (type === "radio" && name) {
        if (seenRadio.has(name)) continue;
        seenRadio.add(name);
        const group = Array.from(
          document.querySelectorAll<HTMLInputElement>(`input[type=radio][name="${CSS.escape(name)}"]`),
        );
        const opts = group.map((r) => {
          const lab = labelFor(r) || r.value;
          return { value: r.value, text: lab };
        });
        const first = group[0]!;
        out.push({
          tag: "input",
          type: "radio",
          name,
          id: first.id || "",
          label: labelFor(first) || name,
          placeholder: "",
          autocomplete: first.autocomplete || "",
          required: group.some((g) => g.required),
          disabled: group.every((g) => g.disabled),
          readonly: false,
          visible: group.some((g) => visible(g)),
          options: opts,
          role: "radiogroup",
          value: group.find((g) => g.checked)?.value ?? "",
          selectorHint: `input[type=radio][name="${name}"]`,
        });
        continue;
      }

      if (type === "hidden") continue;

      out.push({
        tag,
        type,
        name,
        id,
        label: labelFor(el),
        placeholder: input.placeholder || "",
        autocomplete: input.autocomplete || "",
        required: Boolean(input.required),
        disabled: Boolean(input.disabled),
        readonly: Boolean(input.readOnly),
        visible: visible(el),
        options: optionsOf(el),
        role,
        checked: type === "checkbox" ? input.checked : undefined,
        value: input.value ?? "",
        selectorHint: id
          ? `#${CSS.escape(id)}`
          : name
            ? `${tag}[name="${name}"]`
            : tag,
      });
    }

    // actions
    const buttons = Array.from(
      document.querySelectorAll<HTMLElement>("button, input[type=submit], a[role=button]"),
    );
    const next: string[] = [];
    const submit: string[] = [];
    for (const b of buttons) {
      const t = (b.textContent || (b as HTMLInputElement).value || "").trim().toLowerCase();
      const sel = b.id
        ? `#${CSS.escape(b.id)}`
        : b.getAttribute("name")
          ? `${b.tagName.toLowerCase()}[name="${b.getAttribute("name")}"]`
          : `text=${(b.textContent || "").trim()}`;
      if (/\b(next|continue|lanjut|berikutnya)\b/.test(t)) next.push(sel);
      if (/\b(submit|send|kirim|finish|complete)\b/.test(t) || (b as HTMLInputElement).type === "submit") {
        submit.push(sel);
      }
    }

    // captcha signals
    const human_blocks: string[] = [];
    if (
      document.querySelector(
        "iframe[src*='recaptcha'], .g-recaptcha, iframe[src*='hcaptcha'], .h-captcha, iframe[src*='turnstile'], .cf-turnstile",
      )
    ) {
      human_blocks.push("captcha");
    }
    if (document.querySelector('input[type=password][name*="otp"], input[autocomplete="one-time-code"]')) {
      human_blocks.push("otp");
    }

    return { fields: out, next, submit, human_blocks };
  });

  const fields: Field[] = (raw.fields as unknown as RawField[]).map((r) => {
    const ftype = classifyInputType(r.tag, r.type, r.role);
    const { kind, risk } = classifySemantic(
      r.label,
      r.name,
      r.autocomplete,
      ftype,
      r.options,
    );
    const selectors = [
      r.selectorHint,
      r.id ? `#${r.id}` : "",
      r.name ? `${r.tag}[name="${r.name}"]` : "",
      r.label ? `label=${r.label}` : "",
    ].filter(Boolean);

    return {
      field_id: fieldId([r.name, r.id, r.label, r.type, String(pageIndex)]),
      type: ftype === "radio" ? "radio" : ftype,
      input_type: r.type,
      label: r.label || r.name || r.id || "unlabeled",
      placeholder: r.placeholder,
      name: r.name,
      autocomplete: r.autocomplete,
      required: r.required,
      visible: r.visible,
      disabled: r.disabled,
      readonly: r.readonly,
      options: r.options,
      validation: {},
      frame: "main",
      selector_candidates: selectors,
      semantic_kind: kind,
      risk,
      confidence: r.label ? 0.9 : 0.5,
      current_value: r.value ?? null,
    };
  });

  const form_class = classifyFormClass(url, page_title, fields);

  return {
    url,
    page_title,
    form_class,
    page_index: pageIndex,
    fields,
    actions: {
      next: raw.next as string[],
      submit: raw.submit as string[],
    },
    human_blocks: raw.human_blocks as FormSchema["human_blocks"],
    scanned_at: new Date().toISOString(),
  };
}
