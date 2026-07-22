import type { Policy, PolicyMode, PolicyGoal } from "./types.js";

const BASE_CONSTRAINTS = [
  "do_not_admit_crimes",
  "do_not_claim_benefits_unless_true",
  "no_medical_guessing",
  "no_legal_attestation_without_user",
  "no_payment_without_user",
  "no_password_fill",
  "no_qualify_fraud",
] as const;

export const POLICY_PRESETS: Record<string, Policy> = {
  "i-dont-care": {
    mode: "neutral",
    goal: "minimize_contact",
    facts_source: "profile",
    opinions_source: "policy",
    sensitive_default: "prefer_not_to_say",
    optional_default: "skip",
    required_unknown_default: "ask",
    open_text_style: "short_bland",
    allow_auto_submit: false,
    max_repair_attempts: 3,
    constraints: [...BASE_CONSTRAINTS],
  },
  "happy-customer": {
    mode: "best",
    goal: "most_positive",
    facts_source: "profile",
    opinions_source: "policy",
    sensitive_default: "prefer_not_to_say",
    optional_default: "skip",
    required_unknown_default: "ask",
    open_text_style: "short_positive",
    allow_auto_submit: false,
    max_repair_attempts: 3,
    constraints: [...BASE_CONSTRAINTS],
  },
  "angry-but-valid": {
    mode: "worst",
    goal: "most_negative",
    facts_source: "profile",
    opinions_source: "policy",
    sensitive_default: "prefer_not_to_say",
    optional_default: "skip",
    required_unknown_default: "ask",
    open_text_style: "short_negative",
    allow_auto_submit: false,
    max_repair_attempts: 3,
    constraints: [...BASE_CONSTRAINTS],
  },
  "official-truth": {
    mode: "ask",
    goal: "truthful_boring",
    facts_source: "profile",
    opinions_source: "ask",
    sensitive_default: "ask",
    optional_default: "skip",
    required_unknown_default: "ask",
    open_text_style: "short_bland",
    allow_auto_submit: false,
    max_repair_attempts: 3,
    constraints: [...BASE_CONSTRAINTS],
  },
  "survey-persona": {
    mode: "random",
    goal: "look_normal",
    facts_source: "persona",
    opinions_source: "persona",
    sensitive_default: "prefer_not_to_say",
    optional_default: "fill",
    required_unknown_default: "ask",
    open_text_style: "persona",
    allow_auto_submit: false,
    max_repair_attempts: 3,
    constraints: [...BASE_CONSTRAINTS],
  },
};

export function resolvePolicy(
  presetOrMode?: string,
  overrides: Partial<Policy> = {},
): Policy {
  if (presetOrMode && POLICY_PRESETS[presetOrMode]) {
    return { ...POLICY_PRESETS[presetOrMode], ...overrides };
  }
  const mode = (presetOrMode as PolicyMode) || "neutral";
  const base = { ...POLICY_PRESETS["i-dont-care"], mode };
  if (mode === "best") base.goal = "most_positive";
  if (mode === "worst") base.goal = "most_negative";
  if (mode === "random" || mode === "persona") {
    base.facts_source = "persona";
    base.opinions_source = "persona";
  }
  return { ...base, ...overrides };
}

export function listPresets(): string[] {
  return Object.keys(POLICY_PRESETS);
}

export function goalForMode(mode: PolicyMode, goal?: PolicyGoal): PolicyGoal {
  if (goal) return goal;
  switch (mode) {
    case "best":
      return "most_positive";
    case "worst":
      return "most_negative";
    case "neutral":
    case "boring_normal":
      return "look_normal";
    case "random":
    case "persona":
      return "look_normal";
    case "ask":
      return "truthful_boring";
    default:
      return "look_normal";
  }
}
