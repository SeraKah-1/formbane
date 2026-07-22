import type { Field, Persona, Profile } from "./types.js";

type PathValue = string | number | boolean | null | undefined;

/** Static label/name → profile path mappings */
const MAP: Array<{ re: RegExp; path: string }> = [
  { re: /\b(e-?mail|surel)\b/i, path: "identity.email" },
  { re: /\b(phone|mobile|tel|hp|whatsapp)\b/i, path: "identity.phone" },
  { re: /\b(first\s*name|given\s*name|nama\s*depan)\b/i, path: "identity.given_name" },
  { re: /\b(last\s*name|family\s*name|surname|nama\s*belakang)\b/i, path: "identity.family_name" },
  { re: /\b(full\s*name|your\s*name|nama\s*lengkap)\b/i, path: "identity.full_name" },
  { re: /\b(date\s*of\s*birth|dob|birthday|tanggal\s*lahir)\b/i, path: "identity.dob" },
  { re: /\b(nationality|kewarganegaraan)\b/i, path: "identity.nationality" },
  { re: /\b(national\s*id|nik|ssn|ktp)\b/i, path: "identity.national_id" },
  { re: /\b(tax\s*id|npwp|tin)\b/i, path: "identity.tax_id" },
  { re: /\b(street|address\s*line|alamat)\b/i, path: "address.street" },
  { re: /\b(city|kota)\b/i, path: "address.city" },
  { re: /\b(state|region|province|provinsi)\b/i, path: "address.region" },
  { re: /\b(zip|postal|kode\s*pos)\b/i, path: "address.postal_code" },
  { re: /\b(country|negara)\b/i, path: "address.country" },
  { re: /\b(job\s*title|occupation|title|jabatan)\b/i, path: "work.job_title" },
  { re: /\b(company|employer|organization|perusahaan)\b/i, path: "work.company" },
  { re: /\b(employment\s*status|status\s*pekerjaan)\b/i, path: "work.employment_status" },
  { re: /\b(years?\s*(of\s*)?experience|pengalaman)\b/i, path: "work.years_experience" },
];

function getByPath(obj: unknown, path: string): PathValue {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  if (
    typeof cur === "string" ||
    typeof cur === "number" ||
    typeof cur === "boolean" ||
    cur == null
  ) {
    return cur as PathValue;
  }
  return undefined;
}

export function mapFieldToProfile(
  field: Field,
  profile: Profile,
): { value: PathValue; path: string | null; confidence: number } {
  const blob = `${field.label} ${field.name ?? ""} ${field.autocomplete ?? ""} ${field.placeholder ?? ""}`;

  // autocomplete shortcuts
  const ac = (field.autocomplete || "").toLowerCase();
  if (ac === "email") {
    return { value: profile.identity.email, path: "identity.email", confidence: 0.99 };
  }
  if (ac === "tel" || ac === "tel-national") {
    return { value: profile.identity.phone, path: "identity.phone", confidence: 0.99 };
  }
  if (ac === "given-name") {
    return {
      value: profile.identity.given_name,
      path: "identity.given_name",
      confidence: 0.99,
    };
  }
  if (ac === "family-name") {
    return {
      value: profile.identity.family_name,
      path: "identity.family_name",
      confidence: 0.99,
    };
  }
  if (ac === "name") {
    return {
      value: profile.identity.full_name,
      path: "identity.full_name",
      confidence: 0.99,
    };
  }
  if (ac === "bday" || ac === "bday-day") {
    return { value: profile.identity.dob, path: "identity.dob", confidence: 0.95 };
  }
  if (ac.startsWith("address")) {
    const path =
      ac === "address-level2"
        ? "address.city"
        : ac === "postal-code"
          ? "address.postal_code"
          : ac === "country"
            ? "address.country"
            : "address.street";
    return { value: getByPath(profile, path), path, confidence: 0.95 };
  }

  for (const m of MAP) {
    if (m.re.test(blob)) {
      return {
        value: getByPath(profile, m.path),
        path: m.path,
        confidence: 0.9,
      };
    }
  }

  // type-based fallback
  if (field.type === "email") {
    return { value: profile.identity.email, path: "identity.email", confidence: 0.85 };
  }
  if (field.type === "tel") {
    return { value: profile.identity.phone, path: "identity.phone", confidence: 0.85 };
  }

  return { value: undefined, path: null, confidence: 0 };
}

export function mapFieldToPersona(
  field: Field,
  persona: Persona,
): { value: PathValue; confidence: number } {
  const blob = `${field.label} ${field.name ?? ""}`.toLowerCase();
  if (/\bage\b/.test(blob)) return { value: persona.age, confidence: 0.95 };
  if (/\bgender\b/.test(blob)) return { value: persona.gender, confidence: 0.9 };
  if (/\beducation\b/.test(blob)) return { value: persona.education, confidence: 0.9 };
  if (/\bincome\b/.test(blob)) return { value: persona.income_band, confidence: 0.9 };
  if (/\b(employ|job\s*status)\b/.test(blob))
    return { value: persona.employment, confidence: 0.9 };
  if (/\bcompany|employer\b/.test(blob))
    return { value: persona.company, confidence: 0.9 };
  if (/\byears?\s*(of\s*)?experience\b/.test(blob))
    return { value: persona.years_experience, confidence: 0.9 };
  if (/\b(e-?mail)\b/.test(blob))
    return {
      value: `user${persona.seed}@example.com`,
      confidence: 0.7,
    };
  return { value: undefined, confidence: 0 };
}

/** Match option text/value to a free-form answer string */
export function matchOption(
  options: { value: string; text: string }[],
  raw: unknown,
): string | null {
  if (raw == null || raw === "") return null;
  const s = String(raw).toLowerCase().trim();
  for (const o of options) {
    if (o.value.toLowerCase() === s || o.text.toLowerCase() === s) return o.value || o.text;
  }
  for (const o of options) {
    if (o.text.toLowerCase().includes(s) || s.includes(o.text.toLowerCase())) {
      return o.value || o.text;
    }
  }
  return null;
}
