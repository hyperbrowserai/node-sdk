import { FILL_CREDENTIAL_DESCRIPTION, FILL_CREDENTIAL_SCHEMA } from "./schema";

// This declaration covers fill_credential only. General tool/schema conversion
// belongs in a separate change rather than expanding the credentials API.
const nullableString = (description: string) => ({ type: "STRING", nullable: true, description });
const properties = FILL_CREDENTIAL_SCHEMA.properties;

export const FILL_CREDENTIAL_TOOL_GEMINI = {
  name: "fill_credential",
  description: FILL_CREDENTIAL_DESCRIPTION,
  parameters: {
    type: "OBJECT",
    properties: {
      credential: nullableString(properties.credential.description),
      vault: nullableString(properties.vault.description),
      fields: {
        type: "ARRAY",
        description: properties.fields.description,
        minItems: String(properties.fields.minItems),
        maxItems: String(properties.fields.maxItems),
        items: {
          type: "OBJECT",
          properties: {
            selector: {
              type: "STRING",
              description: properties.fields.items.properties.selector.description,
            },
            field: nullableString(properties.fields.items.properties.field.description),
          },
          required: properties.fields.items.required,
        },
      },
      page_id: nullableString(properties.page_id.description),
      page_url: nullableString(properties.page_url.description),
      frame_url: nullableString(properties.frame_url.description),
    },
    required: FILL_CREDENTIAL_SCHEMA.required,
  },
};
