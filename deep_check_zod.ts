import { z } from "zod";

const schema = z.string();

console.log("--- Zod Version Check ---");
// Try to find version if exported, or package.json
try {
  const pkg = require("zod/package.json");
  console.log(`Zod Package Version: ${pkg.version}`);
} catch (e) {
  console.log("Could not read zod/package.json");
}

console.log("\n--- Schema Inspection ---");
console.log("schema instanceof z.ZodType?", schema instanceof z.ZodType);
console.log("'_def' in schema?", "_def" in schema);
console.log("'def' in schema?", "'def' in schema");

// Check own property
console.log("Has own property '_def'?", Object.prototype.hasOwnProperty.call(schema, "_def"));

// Check prototype
const proto = Object.getPrototypeOf(schema);
console.log("Prototype has '_def'?", "_def" in proto);
console.log("Prototype has own property '_def'?", Object.prototype.hasOwnProperty.call(proto, "_def"));

// Check descriptor
const descriptor = Object.getOwnPropertyDescriptor(proto, "_def");
console.log("Prototype '_def' descriptor:", descriptor ? "Exists" : "Undefined");
if (descriptor && descriptor.get) {
  console.log("Prototype '_def' is a Getter");
}

console.log("\n--- Compatibility Check ---");
const isCompatible = "_def" in schema && "parse" in schema && typeof schema.parse === "function";
console.log(`Is Compatible with isZodSchema? ${isCompatible}`);



