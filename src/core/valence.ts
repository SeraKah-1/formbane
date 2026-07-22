import type { Field, FieldOption, PolicyGoal } from "./types.js";

const POSITIVE_WORDS =
  /\b(very\s+satisfied|extremely\s+satisfied|satisfied|excellent|great|good|agree|strongly\s+agree|always|very\s+likely|definitely|easy|clear|fast|helpful|yes)\b/i;
const NEGATIVE_WORDS =
  /\b(very\s+dissatisfied|extremely\s+dissatisfied|dissatisfied|poor|terrible|bad|disagree|strongly\s+disagree|never|very\s+unlikely|difficult|confusing|slow|unhelpful|no)\b/i;
const NEUTRAL_WORDS =
  /\b(neutral|neither|n\/?a|not\s+applicable|prefer\s+not|middle|sometimes|maybe|unsure)\b/i;
const PREFER_NOT = /\b(prefer\s+not|rather\s+not|no\s+thanks|opt\s*out)\b/i;

// Match stems inside words (problems, confusing, …) — trailing \b on "problem" fails on "problems"
const INVERTED_STEM =
  /\b(problems?|issues?|confus\w*|difficult\w*|hard\b|errors?|bugs?|complaint\w*|frustrat\w*|delays?|slow\w*|bad\s+experience|how\s+often[\s\w]*problems?)/i;

/**
 * Score options on a -1..1 valence scale (higher = more "positive experience").
 */
export function scoreOptions(
  label: string,
  options: FieldOption[],
): FieldOption[] {
  if (!options.length) return options;
  const inverted = INVERTED_STEM.test(label);

  // Numeric scale 0-10 or 1-5
  const nums = options.map((o) => {
    const n = Number(String(o.value || o.text).trim());
    return Number.isFinite(n) ? n : null;
  });
  const allNumeric = nums.every((n) => n !== null);

  let scored: FieldOption[];

  if (allNumeric && options.length >= 3) {
    const values = nums as number[];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    scored = options.map((o, i) => {
      const n = values[i]!;
      // Higher number = more positive unless inverted stem
      let v = ((n - min) / span) * 2 - 1;
      if (inverted) v = -v;
      // NPS-like: if 0-10 recommend, high is good (already)
      return { ...o, valence: v };
    });
  } else {
    scored = options.map((o) => {
      const t = `${o.text} ${o.value}`;
      let v = 0;
      if (POSITIVE_WORDS.test(t)) v = 0.8;
      if (/\bvery\s+|strongly\s+|extremely\s+/i.test(t) && POSITIVE_WORDS.test(t))
        v = 1;
      if (NEGATIVE_WORDS.test(t)) v = -0.8;
      if (/\bvery\s+|strongly\s+|extremely\s+/i.test(t) && NEGATIVE_WORDS.test(t))
        v = -1;
      if (NEUTRAL_WORDS.test(t)) v = 0;
      if (PREFER_NOT.test(t)) v = 0.05; // slightly preferred for neutral mode
      if (inverted) v = -v;
      return { ...o, valence: v };
    });
  }

  return scored;
}

export function pickByGoal(
  options: FieldOption[],
  goal: PolicyGoal,
  satisfactionBias = 0,
): FieldOption | null {
  if (!options.length) return null;
  const withV = options.every((o) => o.valence !== undefined)
    ? options
    : scoreOptions("", options);

  if (goal === "most_positive") {
    return withV.reduce((a, b) =>
      (b.valence ?? 0) > (a.valence ?? 0) ? b : a,
    );
  }
  if (goal === "most_negative") {
    return withV.reduce((a, b) =>
      (b.valence ?? 0) < (a.valence ?? 0) ? b : a,
    );
  }
  if (goal === "minimize_contact" || goal === "look_normal" || goal === "truthful_boring") {
    // prefer prefer-not / neutral / closest to 0 (+ small bias)
    const preferNot = withV.find((o) => PREFER_NOT.test(o.text));
    if (preferNot && goal === "minimize_contact") return preferNot;
    const target = satisfactionBias; // -1..1
    return withV.reduce((a, b) => {
      const da = Math.abs((a.valence ?? 0) - target);
      const db = Math.abs((b.valence ?? 0) - target);
      return db < da ? b : a;
    });
  }
  if (goal === "chaos") {
    return withV[Math.floor(Math.random() * withV.length)]!;
  }
  // default neutral-ish
  return withV.reduce((a, b) =>
    Math.abs(b.valence ?? 0) < Math.abs(a.valence ?? 0) ? b : a,
  );
}

export function pickPreferNotOrNeutral(options: FieldOption[]): FieldOption | null {
  if (!options.length) return null;
  const scored = scoreOptions("", options);
  const prefer = scored.find((o) => PREFER_NOT.test(o.text) || /\bn\/?a\b/i.test(o.text));
  if (prefer) return prefer;
  return pickByGoal(scored, "look_normal");
}

export function openTextForStyle(
  style: string,
  field: Field,
): string {
  switch (style) {
    case "short_positive":
      return "Easy and clear.";
    case "short_negative":
      return "Slow, confusing, wasted my time.";
    case "persona":
      return field.label.toLowerCase().includes("why")
        ? "Based on my experience."
        : "Fine overall.";
    case "short_bland":
    default:
      return "N/A";
  }
}
