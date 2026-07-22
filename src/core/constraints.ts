import type { Field, PlannedAnswer, Policy } from "./types.js";

/**
 * Apply hard product constraints to a planned answer.
 * Returns possibly modified answer + warnings.
 */
export function applyConstraints(
  field: Field,
  answer: PlannedAnswer,
  policy: Policy,
): { answer: PlannedAnswer; warnings: string[] } {
  const warnings: string[] = [];
  const constraints = new Set(policy.constraints);
  let out = { ...answer };

  if (constraints.has("no_password_fill")) {
    if (field.type === "password" || field.semantic_kind === "credential") {
      out = {
        ...out,
        value: null,
        skip: true,
        blocked: true,
        block_reason: "password",
        ask_user: false,
        reason: "Password/OTP fields require a human",
        confidence: 1,
        source: "unknown",
      };
      warnings.push(`Blocked credential field: ${field.label}`);
    }
  }

  if (constraints.has("no_payment_without_user")) {
    if (field.semantic_kind === "payment") {
      out = {
        ...out,
        value: null,
        skip: true,
        blocked: true,
        block_reason: "payment",
        reason: "Payment fields require a human",
        confidence: 1,
        source: "unknown",
      };
      warnings.push(`Blocked payment field: ${field.label}`);
    }
  }

  if (constraints.has("no_legal_attestation_without_user")) {
    if (field.semantic_kind === "legal_attestation") {
      out = {
        ...out,
        value: null,
        skip: true,
        blocked: true,
        block_reason: "legal",
        ask_user: true,
        question: `Legal consent: "${field.label}" — confirm only if you agree`,
        options: ["I confirm and agree", "Skip / do not agree"],
        reason: "Legal attestation requires explicit user confirmation",
        confidence: 1,
        source: "unknown",
      };
      warnings.push(`Legal attestation requires confirmation: ${field.label}`);
    }
  }

  if (constraints.has("no_medical_guessing")) {
    if (field.semantic_kind === "medical" && out.source !== "user" && out.source !== "profile") {
      out = {
        ...out,
        value: null,
        ask_user: field.required,
        skip: !field.required,
        reason: "Medical fields are not guessed",
        confidence: 0,
        source: "unknown",
      };
      warnings.push(`Medical field not auto-filled: ${field.label}`);
    }
  }

  if (constraints.has("do_not_admit_crimes")) {
    if (field.semantic_kind === "legal" && /criminal|felony|arrest/i.test(field.label)) {
      if (out.source === "policy" || out.source === "persona") {
        out = {
          ...out,
          value: null,
          ask_user: true,
          reason: "Criminal-history questions require the user",
          confidence: 0,
          source: "unknown",
        };
      }
    }
  }

  if (
    constraints.has("no_qualify_fraud") &&
    policy.goal === "qualify_for_criteria"
  ) {
    warnings.push(
      "Goal qualify_for_criteria is restricted (ToS/fraud risk). Prefer truthful answers.",
    );
  }

  if (field.semantic_kind === "honeypot") {
    out = {
      ...out,
      value: null,
      skip: true,
      reason: "Honeypot — never fill",
      confidence: 1,
      source: "default",
    };
  }

  return { answer: out, warnings };
}

export function collectBlocked(
  answers: PlannedAnswer[],
): Array<"captcha" | "otp" | "login" | "payment" | "legal" | "password"> {
  const set = new Set<"captcha" | "otp" | "login" | "payment" | "legal" | "password">();
  for (const a of answers) {
    if (a.block_reason === "password") set.add("password");
    if (a.block_reason === "payment") set.add("payment");
    if (a.block_reason === "legal") set.add("legal");
    if (a.block_reason === "otp") set.add("otp");
  }
  return [...set];
}
