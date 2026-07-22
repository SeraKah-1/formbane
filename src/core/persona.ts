import type { Persona } from "./types.js";

/** Mulberry32 PRNG — deterministic from seed */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

/**
 * Generate a coherent survey persona from a seed.
 * Rules: employment ↔ company; years_experience constrained by age.
 */
export function generatePersona(seed = Date.now() % 1_000_000): Persona {
  const rng = mulberry32(seed);
  const age = 18 + Math.floor(rng() * 47); // 18–64
  const employment = pick(rng, [
    "employed",
    "unemployed",
    "student",
    "self_employed",
    "retired",
  ] as const);

  let years_experience = 0;
  let company: string | null = null;
  const maxYears = Math.max(0, age - 16);

  if (employment === "employed" || employment === "self_employed") {
    years_experience = Math.min(
      maxYears,
      1 + Math.floor(rng() * Math.max(1, maxYears)),
    );
    company = pick(rng, [
      "Northwind Labs",
      "Blue Harbor Co",
      "Summit Retail",
      "Cedar Systems",
      "Indie Studio",
    ]);
  } else if (employment === "student") {
    years_experience = Math.min(2, maxYears);
    company = null;
  } else if (employment === "retired") {
    years_experience = Math.min(maxYears, 20 + Math.floor(rng() * 15));
    company = null;
  } else {
    years_experience = Math.min(maxYears, Math.floor(rng() * 5));
    company = null;
  }

  // Hard coherence: never claim more years than age allows
  years_experience = Math.min(years_experience, Math.max(0, age - 14));

  const income_bands = [
    "Under $25k",
    "$25k-$50k",
    "$50k-$75k",
    "$75k-$100k",
    "$100k+",
    "Prefer not to say",
  ];

  const bias = (rng() - 0.5) * 1.6; // roughly -0.8..0.8

  return {
    persona_id: `persona_${seed}`,
    seed,
    age,
    gender: pick(rng, ["female", "male", "non-binary", "prefer_not_to_say"]),
    education: pick(rng, [
      "high_school",
      "bachelor",
      "master",
      "doctorate",
      "other",
    ]),
    employment,
    income_band: pick(rng, income_bands),
    company,
    years_experience,
    tech_level: pick(rng, ["low", "medium", "high"]),
    satisfaction_bias: Math.max(-1, Math.min(1, bias)),
    verbosity: pick(rng, ["low", "medium", "high"]),
    contact_preference: pick(rng, ["no", "email_ok", "phone_ok"]),
    traits: [],
  };
}

/** Enforce coherence if persona was mutated */
export function enforcePersonaCoherence(p: Persona): Persona {
  const out = { ...p };
  out.years_experience = Math.min(
    out.years_experience ?? 0,
    Math.max(0, out.age - 14),
  );
  if (
    out.employment === "unemployed" ||
    out.employment === "student" ||
    out.employment === "retired"
  ) {
    out.company = null;
    if (out.employment !== "retired") {
      out.years_experience = Math.min(out.years_experience ?? 0, 2);
    }
  }
  return out;
}
