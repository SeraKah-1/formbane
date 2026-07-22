import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planAnswers, applyUserAnswers } from "../../src/core/planner.js";
import { resolvePolicy } from "../../src/core/policy.js";
import { generatePersona, enforcePersonaCoherence } from "../../src/core/persona.js";
import { scoreOptions, pickByGoal } from "../../src/core/valence.js";
import { DEFAULT_PROFILE, type Field, type FormSchema } from "../../src/core/types.js";

function field(partial: Partial<Field> & Pick<Field, "field_id" | "label" | "type">): Field {
  return {
    input_type: "text",
    required: false,
    visible: true,
    disabled: false,
    readonly: false,
    options: [],
    validation: {},
    frame: "main",
    selector_candidates: [`#${partial.field_id}`],
    semantic_kind: "unknown",
    risk: "low",
    confidence: 0.9,
    ...partial,
  };
}

function schema(fields: Field[], form_class: FormSchema["form_class"] = "survey_junk"): FormSchema {
  return {
    url: "http://127.0.0.1/test",
    page_title: "Test Form",
    form_class,
    page_index: 0,
    fields,
    actions: { submit: ["button"] },
    human_blocks: [],
    scanned_at: new Date().toISOString(),
  };
}

describe("persona coherence", () => {
  it("never claims more experience than age allows", () => {
    for (let seed = 1; seed < 50; seed++) {
      const p = generatePersona(seed);
      assert.ok((p.years_experience ?? 0) <= Math.max(0, p.age - 14));
      if (p.employment === "unemployed" || p.employment === "student") {
        assert.equal(p.company, null);
      }
    }
  });

  it("enforcePersonaCoherence clears company for unemployed", () => {
    const p = enforcePersonaCoherence({
      ...generatePersona(1),
      employment: "unemployed",
      company: "Evil Corp",
      years_experience: 40,
      age: 20,
    });
    assert.equal(p.company, null);
    assert.ok((p.years_experience ?? 0) <= 6);
  });
});

describe("valence", () => {
  it("picks highest for most_positive on satisfaction scale", () => {
    const opts = scoreOptions("How satisfied are you?", [
      { value: "1", text: "Very dissatisfied" },
      { value: "3", text: "Neutral" },
      { value: "5", text: "Very satisfied" },
    ]);
    const best = pickByGoal(opts, "most_positive");
    assert.equal(best?.value, "5");
    const worst = pickByGoal(opts, "most_negative");
    assert.equal(worst?.value, "1");
  });

  it("inverts valence for problem-frequency questions", () => {
    const opts = scoreOptions("How often did you experience problems?", [
      { value: "1", text: "Never" },
      { value: "5", text: "Always" },
    ]);
    const best = pickByGoal(opts, "most_positive");
    assert.equal(best?.value, "1");
  });
});

describe("planner policy modes", () => {
  const fields: Field[] = [
    field({
      field_id: "email",
      label: "Email address",
      type: "email",
      required: true,
      semantic_kind: "contact",
      autocomplete: "email",
    }),
    field({
      field_id: "sat",
      label: "How satisfied are you?",
      type: "radio",
      required: true,
      semantic_kind: "opinion",
      options: [
        { value: "1", text: "Very dissatisfied" },
        { value: "3", text: "Neutral" },
        { value: "5", text: "Very satisfied" },
      ],
    }),
    field({
      field_id: "feedback",
      label: "Feedback",
      type: "textarea",
      semantic_kind: "opinion",
    }),
    field({
      field_id: "legal",
      label: "I certify under penalty of perjury that this is correct",
      type: "checkbox",
      semantic_kind: "legal_attestation",
      risk: "critical",
    }),
    field({
      field_id: "password",
      label: "Password",
      type: "password",
      semantic_kind: "credential",
      risk: "critical",
    }),
    field({
      field_id: "income",
      label: "Income range",
      type: "select",
      required: true,
      semantic_kind: "finance",
      risk: "high",
      options: [
        { value: "low", text: "Under $25k" },
        { value: "mid", text: "$50k-$75k" },
        { value: "pnts", text: "Prefer not to say" },
      ],
    }),
  ];

  it("neutral mode fills profile email and blocks legal/password", () => {
    const plan = planAnswers({
      schema: schema(fields),
      profile: DEFAULT_PROFILE,
      policy: resolvePolicy("i-dont-care"),
      seed: 7,
    });
    const email = plan.answers.find((a) => a.field_id === "email");
    assert.equal(email?.value, DEFAULT_PROFILE.identity.email);
    assert.equal(email?.source, "profile");

    const legal = plan.answers.find((a) => a.field_id === "legal");
    assert.equal(legal?.blocked, true);
    assert.equal(legal?.block_reason, "legal");

    const pw = plan.answers.find((a) => a.field_id === "password");
    assert.equal(pw?.blocked, true);
    assert.ok(plan.blocked.includes("password") || plan.blocked.includes("legal"));
  });

  it("best mode picks most positive satisfaction", () => {
    const plan = planAnswers({
      schema: schema(fields),
      profile: DEFAULT_PROFILE,
      policy: resolvePolicy("happy-customer"),
      seed: 7,
    });
    const sat = plan.answers.find((a) => a.field_id === "sat");
    assert.equal(sat?.value, "5");
    const fb = plan.answers.find((a) => a.field_id === "feedback");
    assert.match(String(fb?.value ?? ""), /easy|clear/i);
  });

  it("worst mode picks most negative satisfaction", () => {
    const plan = planAnswers({
      schema: schema(fields),
      profile: DEFAULT_PROFILE,
      policy: resolvePolicy("angry-but-valid"),
      seed: 7,
    });
    const sat = plan.answers.find((a) => a.field_id === "sat");
    assert.equal(sat?.value, "1");
  });

  it("ask-only-missing does not ask for known profile email", () => {
    const plan = planAnswers({
      schema: schema(fields),
      profile: DEFAULT_PROFILE,
      policy: resolvePolicy("i-dont-care"),
      seed: 7,
    });
    const askIds = plan.questions_for_user.map((q) => q.field_id);
    assert.ok(!askIds.includes("email"));
    // income high-risk may ask or prefer-not
    const income = plan.answers.find((a) => a.field_id === "income");
    assert.ok(income);
    if (income?.ask_user) {
      assert.ok(askIds.includes("income") || askIds.includes("legal"));
    } else {
      // prefer not path
      assert.ok(
        income?.value === "pnts" ||
          String(income?.value).toLowerCase().includes("prefer") ||
          income?.skip,
      );
    }
  });

  it("random persona is coherent for employment/company", () => {
    const plan = planAnswers({
      schema: schema([
        field({
          field_id: "company",
          label: "Company",
          type: "text",
          required: true,
          semantic_kind: "employment",
        }),
        field({
          field_id: "emp",
          label: "Employment status",
          type: "text",
          required: true,
          semantic_kind: "employment",
        }),
      ]),
      profile: DEFAULT_PROFILE,
      policy: resolvePolicy("survey-persona"),
      seed: 3,
    });
    assert.ok(plan.persona);
    const company = plan.answers.find((a) => a.field_id === "company");
    if (
      plan.persona!.employment === "unemployed" ||
      plan.persona!.employment === "student" ||
      plan.persona!.employment === "retired"
    ) {
      assert.ok(
        company?.value === "N/A" || company?.value === null || company?.skip,
      );
    }
  });

  it("official form class uses profile not persona for identity", () => {
    const plan = planAnswers({
      schema: schema(
        [
          field({
            field_id: "email",
            label: "Email address",
            type: "email",
            required: true,
            semantic_kind: "contact",
            autocomplete: "email",
          }),
        ],
        "official",
      ),
      profile: DEFAULT_PROFILE,
      policy: resolvePolicy("survey-persona"),
      seed: 99,
    });
    const email = plan.answers.find((a) => a.field_id === "email");
    assert.equal(email?.source, "profile");
    assert.equal(email?.value, DEFAULT_PROFILE.identity.email);
  });

  it("applyUserAnswers merges legal confirmation", () => {
    const plan = planAnswers({
      schema: schema(fields),
      profile: DEFAULT_PROFILE,
      policy: resolvePolicy("i-dont-care"),
      seed: 1,
    });
    const next = applyUserAnswers(plan, {
      legal: "I confirm and agree",
    });
    const legal = next.answers.find((a) => a.field_id === "legal");
    assert.equal(legal?.value, true);
    assert.equal(legal?.source, "user");
    assert.equal(legal?.ask_user, false);
  });
});
