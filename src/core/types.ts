/** Core Formbane types — pure, no browser I/O */

export type FieldType =
  | "text"
  | "email"
  | "tel"
  | "url"
  | "password"
  | "number"
  | "date"
  | "time"
  | "datetime"
  | "textarea"
  | "select"
  | "radio"
  | "checkbox"
  | "checkbox_group"
  | "matrix"
  | "file"
  | "slider"
  | "rating"
  | "contenteditable"
  | "unknown";

export type SemanticKind =
  | "identity"
  | "contact"
  | "address"
  | "employment"
  | "finance"
  | "medical"
  | "legal"
  | "credential"
  | "opinion"
  | "preference"
  | "demographic"
  | "marketing_consent"
  | "legal_attestation"
  | "payment"
  | "captcha"
  | "honeypot"
  | "unknown";

export type FormClass =
  | "official"
  | "account"
  | "survey_junk"
  | "csat"
  | "unknown";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type PolicyMode =
  | "random"
  | "best"
  | "worst"
  | "neutral"
  | "persona"
  | "ask"
  | "boring_normal";

export type PolicyGoal =
  | "most_positive"
  | "most_negative"
  | "minimize_contact"
  | "look_normal"
  | "truthful_boring"
  | "qualify_for_criteria"
  | "chaos";

export type AnswerSource =
  | "profile"
  | "persona"
  | "policy"
  | "user"
  | "default"
  | "unknown";

export interface FieldOption {
  value: string;
  text: string;
  valence?: number;
}

export interface FieldValidation {
  pattern?: string | null;
  min?: string | number | null;
  max?: string | number | null;
  maxlength?: number | null;
}

export interface Field {
  field_id: string;
  type: FieldType;
  input_type?: string;
  label: string;
  help_text?: string;
  placeholder?: string;
  name?: string;
  autocomplete?: string;
  required: boolean;
  visible: boolean;
  disabled: boolean;
  readonly: boolean;
  options: FieldOption[];
  validation: FieldValidation;
  group?: string;
  frame: string;
  selector_candidates: string[];
  semantic_kind: SemanticKind;
  risk: RiskLevel;
  confidence: number;
  rows?: string[];
  columns?: string[];
  /** Current DOM value if known */
  current_value?: string | boolean | string[] | null;
}

export interface FormSchema {
  url: string;
  page_title: string;
  form_class: FormClass;
  page_index: number;
  fields: Field[];
  actions: {
    next?: string[];
    submit?: string[];
    back?: string[];
  };
  human_blocks: Array<"captcha" | "otp" | "login" | "payment" | "legal">;
  scanned_at: string;
}

export interface Profile {
  version: 1;
  identity: {
    given_name?: string;
    family_name?: string;
    full_name?: string;
    email?: string;
    phone?: string;
    dob?: string;
    nationality?: string;
    national_id?: string;
    tax_id?: string;
  };
  address: {
    street?: string;
    city?: string;
    region?: string;
    postal_code?: string;
    country?: string;
  };
  work: {
    employment_status?: string;
    job_title?: string;
    company?: string;
    years_experience?: number;
  };
  preferences: Record<string, string | boolean | number>;
  sensitive_defaults: {
    political: string;
    religion: string;
    ethnicity: string;
  };
  files: Record<string, string>;
}

export interface Persona {
  persona_id: string;
  seed: number;
  age: number;
  gender?: string;
  education?: string;
  employment:
    | "employed"
    | "unemployed"
    | "student"
    | "self_employed"
    | "retired";
  income_band?: string;
  company?: string | null;
  years_experience?: number;
  tech_level: "low" | "medium" | "high";
  satisfaction_bias: number;
  verbosity: "low" | "medium" | "high";
  contact_preference: "no" | "email_ok" | "phone_ok";
  traits: string[];
}

export type ConstraintId =
  | "do_not_admit_crimes"
  | "do_not_claim_benefits_unless_true"
  | "no_medical_guessing"
  | "no_legal_attestation_without_user"
  | "no_payment_without_user"
  | "no_password_fill"
  | "no_qualify_fraud";

export interface Policy {
  mode: PolicyMode;
  goal?: PolicyGoal;
  facts_source: "profile" | "persona" | "ask";
  opinions_source: "policy" | "persona" | "ask";
  sensitive_default: "prefer_not_to_say" | "skip" | "ask";
  optional_default: "skip" | "fill" | "ask";
  required_unknown_default: "ask" | "stop";
  open_text_style:
    | "short_bland"
    | "short_positive"
    | "short_negative"
    | "persona";
  allow_auto_submit: boolean;
  max_repair_attempts: number;
  constraints: ConstraintId[];
}

export interface PlannedAnswer {
  field_id: string;
  value: unknown | null;
  source: AnswerSource;
  confidence: number;
  ask_user?: boolean;
  question?: string;
  options?: string[];
  reason?: string;
  skip?: boolean;
  blocked?: boolean;
  block_reason?: string;
}

export interface AnswerPlan {
  session_id: string;
  page_index: number;
  persona?: Persona | null;
  answers: PlannedAnswer[];
  questions_for_user: PlannedAnswer[];
  warnings: string[];
  blocked: Array<"captcha" | "otp" | "login" | "payment" | "legal" | "password">;
}

export interface LlmConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

export const DEFAULT_PROFILE: Profile = {
  version: 1,
  identity: {
    given_name: "Alex",
    family_name: "Rivera",
    full_name: "Alex Rivera",
    email: "alex.rivera@example.com",
    phone: "+1-555-0100",
    dob: "1992-04-15",
    nationality: "US",
  },
  address: {
    street: "123 Main St",
    city: "Springfield",
    region: "IL",
    postal_code: "62701",
    country: "United States",
  },
  work: {
    employment_status: "employed",
    job_title: "Software Engineer",
    company: "Acme Corp",
    years_experience: 8,
  },
  preferences: {
    smoking: false,
    marketing_contact: false,
    preferred_language: "English",
  },
  sensitive_defaults: {
    political: "prefer_not_to_say",
    religion: "prefer_not_to_say",
    ethnicity: "prefer_not_to_say",
  },
  files: {},
};
