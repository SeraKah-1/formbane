import { z } from "zod";
import type { Field } from "../core/types.js";
import { LlmClient, redactForLlm } from "./client.js";

const MappingSchema = z.object({
  mappings: z.array(
    z.object({
      field_id: z.string(),
      profile_key: z.string().nullable(),
      valence_inverted: z.boolean().optional(),
      open_text: z.string().optional(),
      confidence: z.number().min(0).max(1).optional(),
    }),
  ),
});

export type LlmFieldAssist = z.infer<typeof MappingSchema>["mappings"][number];

/**
 * Optional LLM assist: map ambiguous fields + valence hints.
 * Sends only labels/options (redacted) — never full profile secrets.
 */
export async function assistFieldMapping(
  client: LlmClient,
  fields: Field[],
  fetchImpl?: typeof fetch,
): Promise<LlmFieldAssist[]> {
  if (!client.enabled) return [];

  const payload = fields.map((f) => ({
    field_id: f.field_id,
    label: redactForLlm(f.label),
    type: f.type,
    options: f.options.map((o) => redactForLlm(o.text)),
    required: f.required,
  }));

  const system = `You help a form agent map fields. Reply JSON only:
{"mappings":[{"field_id":"...","profile_key":"identity.email|null","valence_inverted":false,"open_text":"optional short answer","confidence":0.0}]}
profile_key must be a dotted path under identity/address/work or null.
Never invent legal/medical/tax identity. Prefer null when unsure.`;

  const content = await client.chat(
    [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify({ fields: payload }) },
    ],
    { responseFormat: "json_object", temperature: 0 },
    fetchImpl,
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  const safe = MappingSchema.safeParse(parsed);
  if (!safe.success) return [];
  return safe.data.mappings;
}
