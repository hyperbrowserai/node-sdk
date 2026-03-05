import { z } from "zod";

const schema = z.string();

// Function from src/utils.ts
const isZodSchema = (schema: any): boolean => {
  return (
    schema &&
    typeof schema === "object" &&
    "_def" in schema &&
    "parse" in schema &&
    typeof schema.parse === "function"
  );
};

console.log("Schema keys:", Object.keys(schema));
console.log("Has _def?", "_def" in schema);
console.log("Has _zod?", "_zod" in schema);
console.log("isZodSchema result:", isZodSchema(schema));

if (!isZodSchema(schema)) {
  console.log("❌ Zod v4 schema failed isZodSchema check!");
} else {
  console.log("✅ Zod v4 schema passed isZodSchema check.");
}



