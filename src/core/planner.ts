import { applyConstraints, collectBlocked } from "./constraints.js";
import { isFactField, isOpinionField } from "./classify.js";
import { mapFieldToPersona, mapFieldToProfile, matchOption } from "./mapProfile.js";
import { generatePersona, enforcePersonaCoherence } from "./persona.js";
import { goalForMode } from "./policy.js";
import type {
  AnswerPlan,
  Field,
  FormSchema,
  Persona,
  PlannedAnswer,
  Policy,
  Profile,
} from "./types.js";
import {
  openTextForStyle,
  pickByGoal,
  pickPreferNotOrNeutral,
  scoreOptions,
} from "./valence.js";

export interface PlanInput {
  schema: FormSchema;
  profile: Profile;
  policy: Policy;
  sessionId?: string;
  persona?: Persona | null;
  userAnswers?: Record<string, unknown>;
  /** When true, treat mode ask as still auto-opinions if possible */
  seed?: number;
}

function fieldValueFromOptions(
  field: Field,
  raw: unknown,
): unknown {
  if (!field.options.length) return raw;
  const matched = matchOption(field.options, raw);
  return matched ?? raw;
}

function planOpinion(
  field: Field,
  policy: Policy,
  persona: Persona | null,
): PlannedAnswer {
  const goal = goalForMode(policy.mode, policy.goal);
  const bias = persona?.satisfaction_bias ?? 0;

  if (policy.mode === "ask" && policy.opinions_source === "ask") {
    return {
      field_id: field.field_id,
      value: null,
      source: "unknown",
      confidence: 0,
      ask_user: true,
      question: field.label,
      options: field.options.map((o) => o.text),
      reason: "Policy mode ask",
    };
  }

  // Marketing consent → minimize contact
  if (field.semantic_kind === "marketing_consent") {
    const no = field.options.find((o) =>
      /\bno\b|false|opt\s*out|prefer\s+not|don't|do not/i.test(o.text),
    );
    if (field.type === "checkbox" && !field.options.length) {
      return {
        field_id: field.field_id,
        value: false,
        source: "policy",
        confidence: 0.95,
        reason: "minimize contact",
      };
    }
    if (no) {
      return {
        field_id: field.field_id,
        value: no.value || no.text,
        source: "policy",
        confidence: 0.9,
        reason: "minimize contact",
      };
    }
  }

  if (field.options.length) {
    const scored = scoreOptions(field.label, field.options);
    let pick =
      policy.mode === "neutral" || policy.mode === "boring_normal"
        ? pickPreferNotOrNeutral(scored)
        : pickByGoal(
            scored,
            goal,
            policy.mode === "random" || policy.mode === "persona" ? bias : 0,
          );

    // random/persona: bias toward satisfaction_bias
    if ((policy.mode === "random" || policy.mode === "persona") && scored.length) {
      pick = pickByGoal(scored, "look_normal", bias);
    }

    if (pick) {
      return {
        field_id: field.field_id,
        value: pick.value || pick.text,
        source: policy.mode === "random" || policy.mode === "persona" ? "persona" : "policy",
        confidence: 0.85,
        reason: `policy:${policy.mode}/${goal}`,
      };
    }
  }

  if (field.type === "textarea" || field.type === "text") {
    return {
      field_id: field.field_id,
      value: openTextForStyle(policy.open_text_style, field),
      source: "policy",
      confidence: 0.8,
      reason: `open_text:${policy.open_text_style}`,
    };
  }

  if (!field.required && policy.optional_default === "skip") {
    return {
      field_id: field.field_id,
      value: null,
      skip: true,
      source: "default",
      confidence: 1,
      reason: "optional skip",
    };
  }

  return {
    field_id: field.field_id,
    value: null,
    ask_user: field.required,
    skip: !field.required,
    source: "unknown",
    confidence: 0,
    question: field.label,
    options: field.options.map((o) => o.text),
    reason: "could not plan opinion",
  };
}

function planFact(
  field: Field,
  profile: Profile,
  policy: Policy,
  persona: Persona | null,
): PlannedAnswer {
  if (policy.facts_source === "ask") {
    return {
      field_id: field.field_id,
      value: null,
      source: "unknown",
      confidence: 0,
      ask_user: true,
      question: field.label,
      options: field.options.map((o) => o.text),
      reason: "facts_source=ask",
    };
  }

  if (policy.facts_source === "persona" && persona) {
    const m = mapFieldToPersona(field, persona);
    if (m.value !== undefined && m.value !== null && m.confidence >= 0.5) {
      const val = fieldValueFromOptions(field, m.value);
      // coherence: unemployed → empty company
      if (
        /company|employer/i.test(field.label) &&
        (persona.employment === "unemployed" ||
          persona.employment === "student" ||
          persona.employment === "retired")
      ) {
        return {
          field_id: field.field_id,
          value: field.required ? "N/A" : null,
          skip: !field.required,
          source: "persona",
          confidence: 0.95,
          reason: "persona coherent empty employer",
        };
      }
      return {
        field_id: field.field_id,
        value: val,
        source: "persona",
        confidence: m.confidence,
        reason: "persona map",
      };
    }
  }

  // profile (default for facts)
  const mapped = mapFieldToProfile(field, profile);
  if (mapped.value !== undefined && mapped.value !== null && mapped.value !== "") {
    return {
      field_id: field.field_id,
      value: fieldValueFromOptions(field, mapped.value),
      source: "profile",
      confidence: mapped.confidence,
      reason: mapped.path ?? "profile",
    };
  }

  // sensitive demographic
  if (field.semantic_kind === "demographic" || field.risk === "high") {
    if (policy.sensitive_default === "prefer_not_to_say" && field.options.length) {
      const pn = pickPreferNotOrNeutral(field.options);
      if (pn) {
        return {
          field_id: field.field_id,
          value: pn.value || pn.text,
          source: "default",
          confidence: 0.9,
          reason: "sensitive_default",
        };
      }
    }
    if (policy.sensitive_default === "skip" && !field.required) {
      return {
        field_id: field.field_id,
        value: null,
        skip: true,
        source: "default",
        confidence: 1,
        reason: "sensitive skip",
      };
    }
  }

  if (!field.required && policy.optional_default === "skip") {
    return {
      field_id: field.field_id,
      value: null,
      skip: true,
      source: "default",
      confidence: 1,
      reason: "optional skip",
    };
  }

  if (field.required && policy.required_unknown_default === "ask") {
    return {
      field_id: field.field_id,
      value: null,
      ask_user: true,
      source: "unknown",
      confidence: 0,
      question: field.label,
      options: field.options.map((o) => o.text),
      reason: "required unknown",
    };
  }

  return {
    field_id: field.field_id,
    value: null,
    ask_user: true,
    source: "unknown",
    confidence: 0,
    question: field.label,
    options: field.options.map((o) => o.text),
    reason: "unmapped fact",
  };
}

/**
 * Build an answer plan for a scanned form. Pure function — no browser, no LLM required.
 */
export function planAnswers(input: PlanInput): AnswerPlan {
  const {
    schema,
    profile,
    policy,
    sessionId = `sess_${Date.now()}`,
    userAnswers = {},
  } = input;

  let persona = input.persona ?? null;
  if (
    !persona &&
    (policy.mode === "random" ||
      policy.mode === "persona" ||
      policy.facts_source === "persona" ||
      policy.opinions_source === "persona")
  ) {
    persona = enforcePersonaCoherence(
      generatePersona(input.seed ?? Date.now() % 1_000_000),
    );
  }

  const answers: PlannedAnswer[] = [];
  const warnings: string[] = [];

  // Official forms: never invent identity from persona
  const factsSource =
    schema.form_class === "official" ? "profile" : policy.facts_source;
  const effectivePolicy: Policy =
    factsSource !== policy.facts_source
      ? { ...policy, facts_source: factsSource }
      : policy;

  if (schema.form_class === "official" && policy.mode === "worst") {
    warnings.push("Worst mode disabled for official forms; using profile/ask only");
  }

  for (const field of schema.fields) {
    if (!field.visible || field.disabled) {
      answers.push({
        field_id: field.field_id,
        value: null,
        skip: true,
        source: "default",
        confidence: 1,
        reason: "not visible or disabled",
      });
      continue;
    }

    if (userAnswers[field.field_id] !== undefined) {
      answers.push({
        field_id: field.field_id,
        value: userAnswers[field.field_id],
        source: "user",
        confidence: 1,
        reason: "user provided",
      });
      continue;
    }

    // Hard blocks first (password, payment, legal) via constraints path
    if (
      field.type === "password" ||
      field.semantic_kind === "credential" ||
      field.semantic_kind === "payment" ||
      field.semantic_kind === "legal_attestation" ||
      field.semantic_kind === "honeypot"
    ) {
      const stub: PlannedAnswer = {
        field_id: field.field_id,
        value: null,
        source: "unknown",
        confidence: 0,
      };
      const { answer, warnings: w } = applyConstraints(field, stub, effectivePolicy);
      answers.push(answer);
      warnings.push(...w);
      continue;
    }

    let planned: PlannedAnswer;
    if (isOpinionField(field) || (!isFactField(field) && field.options.length >= 2 && field.semantic_kind === "opinion")) {
      planned = planOpinion(field, effectivePolicy, persona);
    } else if (isFactField(field) || field.type === "email" || field.type === "tel") {
      planned = planFact(field, profile, effectivePolicy, persona);
    } else if (field.options.length >= 2) {
      // treat choice fields as opinions if not facts
      planned = planOpinion(field, effectivePolicy, persona);
    } else if (field.type === "textarea") {
      planned = planOpinion(field, effectivePolicy, persona);
    } else {
      planned = planFact(field, profile, effectivePolicy, persona);
    }

    const { answer, warnings: w } = applyConstraints(field, planned, effectivePolicy);
    answers.push(answer);
    warnings.push(...w);
  }

  // Human blocks from schema
  for (const b of schema.human_blocks) {
    warnings.push(`Human block detected on page: ${b}`);
  }

  const questions_for_user = answers.filter((a) => a.ask_user && !a.skip);
  const blocked = collectBlocked(answers);
  for (const b of schema.human_blocks) {
    if (b === "captcha" || b === "otp" || b === "login" || b === "payment" || b === "legal") {
      if (!blocked.includes(b === "captcha" ? "captcha" : b)) {
        // map captcha into blocked list type
        if (b === "captcha") blocked.push("captcha");
        else if (!blocked.includes(b)) blocked.push(b);
      }
    }
  }

  return {
    session_id: sessionId,
    page_index: schema.page_index,
    persona,
    answers,
    questions_for_user,
    warnings: [...new Set(warnings)],
    blocked: [...new Set(blocked)],
  };
}

/** Merge user answers into an existing plan and re-resolve skips */
export function applyUserAnswers(
  plan: AnswerPlan,
  userAnswers: Record<string, unknown>,
): AnswerPlan {
  const answers = plan.answers.map((a) => {
    if (userAnswers[a.field_id] !== undefined) {
      const v = userAnswers[a.field_id];
      // legal confirm handling
      if (a.block_reason === "legal") {
        const ok =
          v === true ||
          v === "I confirm and agree" ||
          String(v).toLowerCase().includes("confirm");
        return {
          ...a,
          value: ok ? true : null,
          ask_user: false,
          blocked: !ok,
          skip: !ok,
          source: "user" as const,
          confidence: 1,
        };
      }
      return {
        ...a,
        value: v,
        ask_user: false,
        skip: false,
        source: "user" as const,
        confidence: 1,
      };
    }
    return a;
  });
  return {
    ...plan,
    answers,
    questions_for_user: answers.filter((a) => a.ask_user && !a.skip),
    blocked: collectBlocked(answers),
  };
}
