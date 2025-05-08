import { z } from "zod";

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const isZodSchema = (schema: z.ZodSchema | object): schema is z.ZodType => {
  return (
    schema &&
    typeof schema === "object" &&
    "_def" in schema &&
    "parse" in schema &&
    typeof schema.parse === "function"
  );
};
