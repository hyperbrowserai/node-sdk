import * as z3 from "zod"; // User's Zod v3
import { toJSONSchema, z as z4 } from "zod-v4"; // SDK's Zod v4 Native + V4 instance
import { zodToJsonSchema } from "zod-to-json-schema"; // Fallback

const results: { name: string; type: "v3" | "v4"; native: boolean; fallback: boolean }[] = [];

function convertSchema(schema: any, label: string, type: "v3" | "v4") {
  // console.log(`\nTesting: ${label}`);
  let nativeSuccess = false;
  let fallbackSuccess = false;

  // 1. Try Native V4
  try {
    const res = toJSONSchema(schema);
    nativeSuccess = true;
    console.log(`[Native V4] Success: ${JSON.stringify(res)}`);
  } catch (e: any) {
    // console.log("   ❌ Native V4 conversion FAILED");
  }

  // 2. Fallback to Library
  try {
    const res = zodToJsonSchema(schema);
    fallbackSuccess = true;
    console.log(`[Fallback] Success: ${JSON.stringify(res)}`);
  } catch (e2: any) {
    // console.log("   ❌ Fallback conversion FAILED");
  }

  results.push({ name: label, type, native: nativeSuccess, fallback: fallbackSuccess });
}

console.log("Running Comprehensive Zod Compatibility Test Suite...\n");

// === ZOD V3 SCENARIOS ===

convertSchema(z3.string(), "Basic String", "v3");
convertSchema(z3.string().email(), "String Email (.email())", "v3");
convertSchema(z3.object({ a: z3.string() }).nonstrict(), "Object Non-strict (.nonstrict())", "v3");
convertSchema(
  z3.string({ invalid_type_error: "bad" }),
  "String custom error (invalid_type_error)",
  "v3"
);
convertSchema(
  z3.intersection(z3.object({ a: z3.string() }), z3.object({ b: z3.number() })),
  "Intersection",
  "v3"
);
convertSchema(z3.number().safe(), "Number Safe (.safe())", "v3");
enum Color3 {
  Red = "Red",
}
convertSchema(z3.nativeEnum(Color3), "Native Enum", "v3");

// === ZOD V4 SCENARIOS ===

convertSchema(z4.string(), "Basic String", "v4");
convertSchema(z4.string().email(), "String Email (.email())", "v4");
// convertSchema(z4.email(), "Email (Top-level)", "v4"); // Uncomment if z4.email exists

convertSchema(z4.object({ a: z4.string() }).loose(), "Object Passthrough (.passthrough())", "v4");
// If deprecated, maybe use: z4.object({ a: z4.string() }, { unknownKeys: "passthrough" })?

// In V4 invalid_type_error is removed/changed, but let's test a standard schema
convertSchema(z4.string().describe("desc"), "String with Description", "v4");
convertSchema(
  z4.intersection(z4.object({ a: z4.string() }), z4.object({ b: z4.number() })),
  "Intersection",
  "v4"
);
convertSchema(z4.number().int(), "Number Int (.int())", "v4");
enum Color4 {
  Blue = "Blue",
}
// z.nativeEnum is deprecated in v4
convertSchema(z4.enum(["Blue"]), "Enum (Replacement for nativeEnum)", "v4");

// === SUMMARY ===

console.log("\n" + "=".repeat(80));
console.log(
  String("SCENARIO").padEnd(40) +
    String("TYPE").padEnd(10) +
    String("NATIVE (V4)").padEnd(15) +
    String("FALLBACK (LIB)").padEnd(15)
);
console.log("-".repeat(80));

results.forEach((r) => {
  const nativeIcon = r.native ? "✅ PASS" : "❌ FAIL";
  const fallbackIcon = r.fallback ? "✅ PASS" : "❌ FAIL"; // Note: Fallback library might handle v4 too!
  console.log(
    r.name.padEnd(40) + r.type.padEnd(10) + nativeIcon.padEnd(15) + fallbackIcon.padEnd(15)
  );
});

console.log("=".repeat(80));
console.log("\nInterpretation:");
console.log("1. Zod v3 schemas SHOULD fail Native V4 but PASS Fallback.");
console.log("2. Zod v4 schemas SHOULD PASS Native V4.");
console.log("3. If both pass for v4, that is fine (library supports v4 too).");
console.log("4. Our code uses Native first, then catches and uses Fallback.");
