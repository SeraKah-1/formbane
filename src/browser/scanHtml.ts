/**
 * Offline HTML form scanner (no Playwright, no extra DOM deps).
 * Good enough for fixtures + CI when browsers cannot launch.
 */
import { createHash } from "node:crypto";
import {
  classifyFormClass,
  classifyInputType,
  classifySemantic,
} from "../core/classify.js";
import type { Field, FieldOption, FormSchema } from "../core/types.js";

function fieldId(parts: string[]): string {
  return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 12);
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function attr(tag: string, name: string): string {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const m = tag.match(re);
  if (!m) return "";
  return decode(m[2] ?? m[3] ?? m[4] ?? "");
}

function hasAttr(tag: string, name: string): boolean {
  return new RegExp(`\\b${name}\\b`, "i").test(tag);
}

function stripTags(s: string): string {
  return decode(s.replace(/<[^>]+>/g, " "));
}

function titleOf(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? stripTags(m[1]!) : "untitled";
}

function findLabel(html: string, id: string, name: string, nearbyBefore: string): string {
  if (id) {
    const re = new RegExp(
      `<label[^>]*\\bfor\\s*=\\s*["']${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*>([\\s\\S]*?)<\\/label>`,
      "i",
    );
    const m = html.match(re);
    if (m) return stripTags(m[1]!);
  }
  // Nearest fieldset legend (prefer over distant labels)
  const fsIdx = nearbyBefore.toLowerCase().lastIndexOf("<fieldset");
  if (fsIdx >= 0) {
    const chunk = nearbyBefore.slice(fsIdx);
    const leg = chunk.match(/<legend[^>]*>([\s\S]*?)<\/legend>/i);
    if (leg) return stripTags(leg[1]!);
  }
  // Nearest opening <label> only (not the first in the window)
  const labIdx = nearbyBefore.toLowerCase().lastIndexOf("<label");
  if (labIdx >= 0) {
    const chunk = nearbyBefore.slice(labIdx);
    const wrap = chunk.match(/^<label\b[^>]*>([\s\S]*)$/i);
    if (wrap) {
      const inner = wrap[1]!.replace(/<input[\s\S]*$/i, "");
      const t = stripTags(inner);
      if (t && t.length < 120) return t;
    }
  }
  // previous short text node
  const prev = nearbyBefore.slice(-160);
  const textBits = prev
    .replace(/<[^>]+>/g, "\n")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const last = textBits[textBits.length - 1];
  if (last && last.length < 80) return last;
  return name || id || "";
}

export function scanHtml(
  html: string,
  opts: { url?: string; page_title?: string; page_index?: number } = {},
): FormSchema {
  const page_title = opts.page_title || titleOf(html);
  const url = opts.url ?? "file://fixture.html";
  const page_index = opts.page_index ?? 0;
  const fields: Field[] = [];
  const seenRadio = new Set<string>();

  // inputs
  const inputRe = /<input\b([^>]*)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = inputRe.exec(html))) {
    const tag = m[0]!;
    const attrs = m[1]!;
    const type = (attr(attrs, "type") || "text").toLowerCase();
    if (type === "hidden" || type === "submit" || type === "button" || type === "image") continue;
    const name = attr(attrs, "name");
    const id = attr(attrs, "id");
    const autocomplete = attr(attrs, "autocomplete");
    const placeholder = attr(attrs, "placeholder");
    const aria = attr(attrs, "aria-label");
    const nearby = html.slice(Math.max(0, m.index - 400), m.index);

    if (type === "radio" && name) {
      if (seenRadio.has(name)) continue;
      seenRadio.add(name);
      const options: FieldOption[] = [];
      const radioRe = new RegExp(
        `<input\\b([^>]*\\btype\\s*=\\s*["']?radio["']?[^>]*\\bname\\s*=\\s*["']${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*)\\/?>`,
        "gi",
      );
      let rm: RegExpExecArray | null;
      while ((rm = radioRe.exec(html))) {
        const ra = rm[1]!;
        const val = attr(ra, "value");
        const rid = attr(ra, "id");
        const rNear = html.slice(Math.max(0, rm.index - 200), rm.index + rm[0]!.length + 80);
        let text = attr(ra, "aria-label") || findLabel(html, rid, name, rNear);
        // label wrapping often has text after input
        const after = html.slice(rm.index + rm[0]!.length, rm.index + rm[0]!.length + 120);
        const afterText = stripTags(after.split("</label>")[0] || "");
        if (afterText && afterText.length < 80) text = afterText || text;
        options.push({ value: val, text: text || val });
      }
      const label =
        aria ||
        findLabel(html, id, name, nearby) ||
        name;
      const ftype = classifyInputType("input", "radio");
      const { kind, risk } = classifySemantic(label, name, "", ftype, options);
      fields.push({
        field_id: fieldId([name, "radio", label, String(page_index)]),
        type: "radio",
        input_type: "radio",
        label,
        name,
        required: /required/i.test(attrs) || options.length > 0 && /required/i.test(html),
        visible: true,
        disabled: false,
        readonly: false,
        options,
        validation: {},
        frame: "main",
        selector_candidates: [`input[type=radio][name="${name}"]`],
        semantic_kind: kind,
        risk,
        confidence: 0.85,
      });
      const anyReq = new RegExp(
        `<input\\b[^>]*type\\s*=\\s*["']?radio["']?[^>]*name\\s*=\\s*["']${name}["'][^>]*required`,
        "i",
      ).test(html);
      fields[fields.length - 1]!.required = anyReq;
      continue;
    }

    // Prefer text immediately after checkbox/radio inside wrapping label
    let label = aria || findLabel(html, id, name, nearby) || placeholder || name || id || "unlabeled";
    if (type === "checkbox" || type === "radio") {
      const after = html.slice(m.index + tag.length, m.index + tag.length + 160);
      const afterText = stripTags(after.split("</label>")[0] || "");
      if (afterText && afterText.length > 1 && afterText.length < 160) {
        label = afterText;
      }
    }
    const ftype = classifyInputType("input", type);
    const { kind, risk } = classifySemantic(label, name, autocomplete, ftype, []);
    fields.push({
      field_id: fieldId([name, id, label, type, String(page_index)]),
      type: ftype,
      input_type: type,
      label,
      placeholder,
      name,
      autocomplete,
      required: hasAttr(attrs, "required"),
      visible: true,
      disabled: hasAttr(attrs, "disabled"),
      readonly: hasAttr(attrs, "readonly"),
      options: [],
      validation: {},
      frame: "main",
      selector_candidates: [id ? `#${id}` : "", name ? `input[name="${name}"]` : ""].filter(Boolean),
      semantic_kind: kind,
      risk,
      confidence: 0.85,
    });
  }

  // selects
  const selectRe = /<select\b([^>]*)>([\s\S]*?)<\/select>/gi;
  while ((m = selectRe.exec(html))) {
    const attrs = m[1]!;
    const body = m[2]!;
    const name = attr(attrs, "name");
    const id = attr(attrs, "id");
    const nearby = html.slice(Math.max(0, m.index - 400), m.index);
    const label = findLabel(html, id, name, nearby) || name || id || "select";
    const options: FieldOption[] = [];
    const optRe = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
    let om: RegExpExecArray | null;
    while ((om = optRe.exec(body))) {
      const oa = om[1]!;
      const text = stripTags(om[2]!);
      const value = attr(oa, "value") || text;
      options.push({ value, text });
    }
    const ftype = classifyInputType("select", "select");
    const { kind, risk } = classifySemantic(label, name, "", ftype, options);
    fields.push({
      field_id: fieldId([name, id, label, "select", String(page_index)]),
      type: "select",
      input_type: "select",
      label,
      name,
      required: hasAttr(attrs, "required"),
      visible: true,
      disabled: hasAttr(attrs, "disabled"),
      readonly: false,
      options,
      validation: {},
      frame: "main",
      selector_candidates: [id ? `#${id}` : "", name ? `select[name="${name}"]` : ""].filter(Boolean),
      semantic_kind: kind,
      risk,
      confidence: 0.9,
    });
  }

  // textareas
  const taRe = /<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi;
  while ((m = taRe.exec(html))) {
    const attrs = m[1]!;
    const name = attr(attrs, "name");
    const id = attr(attrs, "id");
    const nearby = html.slice(Math.max(0, m.index - 400), m.index);
    const label = findLabel(html, id, name, nearby) || name || id || "textarea";
    const ftype = classifyInputType("textarea", "textarea");
    const { kind, risk } = classifySemantic(label, name, "", ftype, []);
    fields.push({
      field_id: fieldId([name, id, label, "textarea", String(page_index)]),
      type: "textarea",
      input_type: "textarea",
      label,
      name,
      required: hasAttr(attrs, "required"),
      visible: true,
      disabled: hasAttr(attrs, "disabled"),
      readonly: hasAttr(attrs, "readonly"),
      options: [],
      validation: {},
      frame: "main",
      selector_candidates: [id ? `#${id}` : "", name ? `textarea[name="${name}"]` : ""].filter(Boolean),
      semantic_kind: kind,
      risk,
      confidence: 0.9,
    });
  }

  const next: string[] = [];
  const submit: string[] = [];
  const btnRe = /<(button|input)\b([^>]*)>(?:([\s\S]*?)<\/button>)?/gi;
  while ((m = btnRe.exec(html))) {
    const tag = m[1]!.toLowerCase();
    const attrs = m[2]!;
    const type = attr(attrs, "type").toLowerCase();
    if (tag === "input" && type !== "submit" && type !== "button") continue;
    const id = attr(attrs, "id");
    const text = stripTags(m[3] || attr(attrs, "value") || "");
    const sel = id ? `#${id}` : `text=${text}`;
    const t = text.toLowerCase();
    if (/\b(next|continue)\b/.test(t)) next.push(sel);
    if (/\b(submit|send|finish)\b/.test(t) || type === "submit") submit.push(sel);
  }

  const form_class = classifyFormClass(url, page_title, fields);
  return {
    url,
    page_title,
    form_class,
    page_index,
    fields,
    actions: { next, submit },
    human_blocks: [],
    scanned_at: new Date().toISOString(),
  };
}

export function fillHtml(
  html: string,
  plan: { answers: Array<{ field_id: string; value: unknown; skip?: boolean; blocked?: boolean }> },
  schema: FormSchema,
): string {
  let out = html;
  const byId = new Map(schema.fields.map((f) => [f.field_id, f]));

  for (const ans of plan.answers) {
    if (ans.skip || ans.blocked || ans.value == null || ans.value === "") continue;
    const field = byId.get(ans.field_id);
    if (!field) continue;
    if (field.type === "password" || field.semantic_kind === "legal_attestation") continue;

    const v = String(ans.value).replace(/"/g, "&quot;");

    if (field.type === "radio" && field.name) {
      // mark matching radio checked
      const name = field.name;
      out = out.replace(
        new RegExp(
          `(<input\\b[^>]*type\\s*=\\s*["']?radio["']?[^>]*name\\s*=\\s*["']${name}["'][^>]*)(\\/?>)`,
          "gi",
        ),
        (full, pre: string, end: string) => {
          const val = attr(pre, "value");
          const cleaned = pre.replace(/\schecked(\s*=\s*["'][^"']*["'])?/gi, "");
          if (val === String(ans.value)) {
            return `${cleaned} checked${end}`;
          }
          return `${cleaned}${end}`;
        },
      );
      continue;
    }

    if (field.type === "checkbox" && field.name) {
      const want = Boolean(ans.value) && ans.value !== "false";
      out = out.replace(
        new RegExp(
          `(<input\\b[^>]*type\\s*=\\s*["']?checkbox["']?[^>]*name\\s*=\\s*["']${field.name}["'][^>]*)(\\/?>)`,
          "i",
        ),
        (_full, pre: string, end: string) => {
          const cleaned = pre.replace(/\schecked(\s*=\s*["'][^"']*["'])?/gi, "");
          return want ? `${cleaned} checked${end}` : `${cleaned}${end}`;
        },
      );
      continue;
    }

    if (field.type === "select" && field.name) {
      out = out.replace(
        new RegExp(
          `(<select\\b[^>]*name\\s*=\\s*["']${field.name}["'][^>]*>)([\\s\\S]*?)(<\\/select>)`,
          "i",
        ),
        (_full, open: string, body: string, close: string) => {
          const nb = body.replace(
            /<option\b([^>]*)>([\s\S]*?)<\/option>/gi,
            (ofull, oa: string, text: string) => {
              const ov = attr(oa, "value") || stripTags(text);
              const cleaned = oa.replace(/\sselected(\s*=\s*["'][^"']*["'])?/gi, "");
              if (ov === String(ans.value) || stripTags(text) === String(ans.value)) {
                return `<option${cleaned} selected>${text}</option>`;
              }
              return `<option${cleaned}>${text}</option>`;
            },
          );
          return `${open}${nb}${close}`;
        },
      );
      continue;
    }

    if (field.type === "textarea" && (field.name || field.selector_candidates[0])) {
      const key = field.name
        ? `name\\s*=\\s*["']${field.name}["']`
        : `id\\s*=\\s*["']${(field.selector_candidates[0] || "").replace(/^#/, "")}["']`;
      out = out.replace(
        new RegExp(`(<textarea\\b[^>]*${key}[^>]*>)([\\s\\S]*?)(<\\/textarea>)`, "i"),
        `$1${String(ans.value).replace(/\$/g, "$$$$")}$3`,
      );
      continue;
    }

    // text-like inputs by id or name
    const id = field.selector_candidates.find((s) => s.startsWith("#"))?.slice(1);
    if (id) {
      out = out.replace(
        new RegExp(`(<input\\b[^>]*\\bid\\s*=\\s*["']${id}["'][^>]*?)(\\/?>)`, "i"),
        (_full, pre: string, end: string) => {
          if (/\bvalue\s*=/.test(pre)) {
            return `${pre.replace(/\bvalue\s*=\s*(".*?"|'.*?'|[^\s>]+)/i, `value="${v}"`)}${end}`;
          }
          return `${pre} value="${v}"${end}`;
        },
      );
    } else if (field.name) {
      out = out.replace(
        new RegExp(
          `(<input\\b[^>]*\\bname\\s*=\\s*["']${field.name}["'][^>]*?)(\\/?>)`,
          "i",
        ),
        (_full, pre: string, end: string) => {
          if (/\bvalue\s*=/.test(pre)) {
            return `${pre.replace(/\bvalue\s*=\s*(".*?"|'.*?'|[^\s>]+)/i, `value="${v}"`)}${end}`;
          }
          return `${pre} value="${v}"${end}`;
        },
      );
    }
  }

  return out;
}
