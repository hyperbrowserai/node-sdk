import { FILL_CREDENTIAL_DESCRIPTION, FILL_CREDENTIAL_SCHEMA } from "./schema";

/** Gemini's schema types, as `@google/genai`'s `Type` enum spells them. */
export type GeminiType = "STRING" | "NUMBER" | "INTEGER" | "BOOLEAN" | "ARRAY" | "OBJECT";

/**
 * Gemini's OpenAPI-subset schema: no `additionalProperties`, and `nullable`
 * instead of type arrays. Integer limits are strings, as in the API.
 */
export interface GeminiSchema {
  /**
   * A `GeminiType`. Typed loosely so declarations can be passed where
   * `@google/genai` expects its `Type` enum, which string literals can't be
   * assigned to.
   */
  type?: any;
  description?: string;
  nullable?: boolean;
  enum?: string[];
  format?: string;
  title?: string;
  default?: unknown;
  properties?: Record<string, GeminiSchema>;
  required?: string[];
  items?: GeminiSchema;
  minItems?: string;
  maxItems?: string;
  minLength?: string;
  maxLength?: string;
  minimum?: number;
  maximum?: number;
  pattern?: string;
}

/** A function declaration for Gemini: `tools: [{ functionDeclarations: [...] }]`. */
export interface FunctionDeclaration {
  name: string;
  description?: string;
  parameters?: GeminiSchema;
}

const GEMINI_TYPES: Record<string, GeminiType> = {
  string: "STRING",
  number: "NUMBER",
  integer: "INTEGER",
  boolean: "BOOLEAN",
  array: "ARRAY",
  object: "OBJECT",
};

/** Keywords Gemini accepts unchanged. Anything else is dropped. */
const COPIED_KEYWORDS = [
  "description",
  "enum",
  "format",
  "title",
  "default",
  "required",
  "minimum",
  "maximum",
  "pattern",
] as const;
/** Integer keywords Gemini takes as strings (int64). */
const INTEGER_KEYWORDS = ["minItems", "maxItems", "minLength", "maxLength"] as const;

const isRecord = (value: unknown): value is Record<string, any> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Convert one of the SDK's JSON Schemas (as used for OpenAI and Anthropic) to
 * Gemini's schema form: `["string", "null"]` becomes `"STRING"` with
 * `nullable: true`, and `additionalProperties` is dropped.
 */
export function toGeminiSchema(schema: Record<string, any>): GeminiSchema {
  if (!isRecord(schema)) {
    throw new TypeError("A JSON Schema object is required");
  }
  const result: GeminiSchema = {};
  if (schema.type !== undefined) {
    const types: unknown[] = Array.isArray(schema.type) ? schema.type : [schema.type];
    const nonNull = types.filter((type) => type !== "null");
    if (nonNull.length !== 1 || typeof nonNull[0] !== "string" || !GEMINI_TYPES[nonNull[0]]) {
      throw new TypeError(`Unsupported schema type for Gemini: ${JSON.stringify(schema.type)}`);
    }
    result.type = GEMINI_TYPES[nonNull[0]];
    if (nonNull.length < types.length) {
      result.nullable = true;
    }
  }
  if (schema.nullable === true) {
    result.nullable = true;
  }
  for (const keyword of COPIED_KEYWORDS) {
    if (schema[keyword] !== undefined) {
      (result as Record<string, unknown>)[keyword] = schema[keyword];
    }
  }
  for (const keyword of INTEGER_KEYWORDS) {
    if (schema[keyword] !== undefined) {
      result[keyword] = String(schema[keyword]);
    }
  }
  if (isRecord(schema.properties)) {
    result.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([name, property]) => [name, toGeminiSchema(property)])
    );
  }
  if (isRecord(schema.items)) {
    result.items = toGeminiSchema(schema.items);
  }
  return result;
}

/** Build a Gemini function declaration from a JSON Schema tool definition. */
export const toGeminiFunctionDeclaration = (
  name: string,
  description: string,
  parameters: Record<string, any>
): FunctionDeclaration => ({ name, description, parameters: toGeminiSchema(parameters) });

export const FILL_CREDENTIAL_TOOL_GEMINI: FunctionDeclaration = toGeminiFunctionDeclaration(
  "fill_credential",
  FILL_CREDENTIAL_DESCRIPTION,
  FILL_CREDENTIAL_SCHEMA
);
