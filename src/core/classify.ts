import type {
  Field,
  FieldType,
  FormClass,
  RiskLevel,
  SemanticKind,
} from "./types.js";

const PAYMENT_RE =
  /\b(card\s*number|credit\s*card|cvv|cvc|expiry|billing|payment|iban|routing\s*number)\b/i;
const LEGAL_RE =
  /\b(i\s+(certify|declare|agree|attest)|under\s+penalty|perjury|terms\s+and\s+conditions|saya\s+menyatakan|legal\s+consent)\b/i;
const CREDENTIAL_RE =
  /\b(password|passwd|otp|one[-\s]?time|2fa|verification\s*code|mfa)\b/i;
const MEDICAL_RE =
  /\b(diagnosis|medication|allergy|medical\s*history|symptom|disease)\b/i;
const CRIME_RE =
  /\b(criminal|felony|arrest|conviction|offense)\b/i;
const EMAIL_RE = /\b(e-?mail|surel)\b/i;
const PHONE_RE = /\b(phone|mobile|tel|hp|whatsapp|handphone)\b/i;
const NAME_RE = /\b(full\s*name|first\s*name|last\s*name|given\s*name|family\s*name|nama)\b/i;
const ADDRESS_RE =
  /\b(address|street|city|zip|postal|province|negara|alamat|country|negara)\b/i;
const DOB_RE = /\b(date\s*of\s*birth|dob|birthday|tanggal\s*lahir)\b/i;
const OPINION_RE =
  /\b(satisf|recommend|agree|likely|rate|feedback|comment|opinion|how\s+often|how\s+would|nps)\b/i;
const MARKETING_RE =
  /\b(newsletter|marketing|promotional|contact\s+me|stay\s+in\s+touch)\b/i;
const SENSITIVE_RE =
  /\b(politic|religion|ethnicity|race|gender\s*identity|sexual)\b/i;

export function classifyInputType(
  tag: string,
  typeAttr: string,
  role?: string,
): FieldType {
  const t = (typeAttr || "").toLowerCase();
  const tagL = tag.toLowerCase();
  if (tagL === "textarea") return "textarea";
  if (tagL === "select") return "select";
  if (t === "email") return "email";
  if (t === "tel") return "tel";
  if (t === "url") return "url";
  if (t === "password") return "password";
  if (t === "number" || t === "range") return t === "range" ? "slider" : "number";
  if (t === "date") return "date";
  if (t === "time") return "time";
  if (t === "datetime-local") return "datetime";
  if (t === "checkbox") return "checkbox";
  if (t === "radio") return "radio";
  if (t === "file") return "file";
  if (role === "combobox" || role === "listbox") return "select";
  if (role === "slider") return "slider";
  if (tagL === "input" || t === "text" || t === "search") return "text";
  return "unknown";
}

export function classifySemantic(
  label: string,
  name: string,
  autocomplete: string,
  type: FieldType,
  options: { text: string; value: string }[],
): { kind: SemanticKind; risk: RiskLevel } {
  const blob = `${label} ${name} ${autocomplete}`.trim();

  if (type === "password" || CREDENTIAL_RE.test(blob)) {
    return { kind: "credential", risk: "critical" };
  }
  if (PAYMENT_RE.test(blob)) {
    return { kind: "payment", risk: "critical" };
  }
  if (LEGAL_RE.test(blob) || (type === "checkbox" && LEGAL_RE.test(label))) {
    return { kind: "legal_attestation", risk: "critical" };
  }
  if (MEDICAL_RE.test(blob)) {
    return { kind: "medical", risk: "high" };
  }
  if (CRIME_RE.test(blob)) {
    return { kind: "legal", risk: "high" };
  }
  if (MARKETING_RE.test(blob)) {
    return { kind: "marketing_consent", risk: "medium" };
  }
  if (SENSITIVE_RE.test(blob)) {
    return { kind: "demographic", risk: "high" };
  }
  if (type === "email" || EMAIL_RE.test(blob) || autocomplete.includes("email")) {
    return { kind: "contact", risk: "medium" };
  }
  if (type === "tel" || PHONE_RE.test(blob) || autocomplete.includes("tel")) {
    return { kind: "contact", risk: "medium" };
  }
  if (DOB_RE.test(blob) || autocomplete.includes("bday")) {
    return { kind: "identity", risk: "high" };
  }
  if (NAME_RE.test(blob) || /name/.test(autocomplete)) {
    return { kind: "identity", risk: "medium" };
  }
  if (ADDRESS_RE.test(blob) || autocomplete.startsWith("address")) {
    return { kind: "address", risk: "medium" };
  }
  if (/\b(job|employ|company|occupation|title)\b/i.test(blob)) {
    return { kind: "employment", risk: "medium" };
  }
  if (/\b(income|salary|wage)\b/i.test(blob)) {
    return { kind: "finance", risk: "high" };
  }

  // Opinion: Likert / NPS / satisfaction options
  if (
    OPINION_RE.test(blob) ||
    (options.length >= 3 && looksLikeScale(options.map((o) => o.text)))
  ) {
    return { kind: "opinion", risk: "low" };
  }

  if (type === "textarea" && OPINION_RE.test(blob)) {
    return { kind: "opinion", risk: "low" };
  }

  return { kind: "unknown", risk: "low" };
}

function looksLikeScale(texts: string[]): boolean {
  const joined = texts.join(" ").toLowerCase();
  if (/\b(very|somewhat|neither|agree|disagree|satisfied|dissatisfied)\b/.test(joined)) {
    return true;
  }
  // 1-5 or 0-10 numeric options
  const nums = texts.map((t) => Number(t.trim())).filter((n) => !Number.isNaN(n));
  if (nums.length >= 3 && nums.length === texts.length) return true;
  return false;
}

export function classifyFormClass(url: string, title: string, fields: Field[]): FormClass {
  const blob = `${url} ${title}`.toLowerCase();
  if (/\.gov\b|government|tax|immigration|permit|bpjs|pajak|nik\b/.test(blob)) {
    return "official";
  }
  if (fields.some((f) => f.semantic_kind === "payment" || f.risk === "critical" && f.semantic_kind === "legal_attestation")) {
    if (fields.some((f) => f.semantic_kind === "payment")) return "account";
  }
  if (/typeform|surveymonkey|qualtrics|google\.com\/forms|forms\.gle|csat|feedback|nps/.test(blob)) {
    if (/csat|satisfaction|nps|feedback/.test(blob)) return "csat";
    return "survey_junk";
  }
  const opinionHeavy =
    fields.filter((f) => f.semantic_kind === "opinion").length >
    fields.length * 0.4;
  if (opinionHeavy) return "survey_junk";
  if (fields.some((f) => f.semantic_kind === "identity" && f.required)) {
    return "account";
  }
  return "unknown";
}

export function isOpinionField(field: Field): boolean {
  return (
    field.semantic_kind === "opinion" ||
    field.semantic_kind === "preference" ||
    field.semantic_kind === "marketing_consent"
  );
}

export function isFactField(field: Field): boolean {
  return (
    field.semantic_kind === "identity" ||
    field.semantic_kind === "contact" ||
    field.semantic_kind === "address" ||
    field.semantic_kind === "employment" ||
    field.semantic_kind === "finance" ||
    field.semantic_kind === "medical" ||
    field.semantic_kind === "demographic" ||
    field.semantic_kind === "legal"
  );
}
