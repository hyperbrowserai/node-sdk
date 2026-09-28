/**
 * Conservative Dockerfile analysis for remote build context selection.
 *
 * This module intentionally does not try to execute or fully reproduce the
 * BuildKit Dockerfile frontend. It recognizes the context-consuming syntax the
 * SDK can analyze safely and requests a full context for anything ambiguous.
 * That keeps sparse uploads an optimization rather than a correctness
 * requirement.
 */

const KNOWN_INSTRUCTIONS = new Set([
  "ADD",
  "ARG",
  "CMD",
  "COPY",
  "ENTRYPOINT",
  "ENV",
  "EXPOSE",
  "FROM",
  "HEALTHCHECK",
  "LABEL",
  "MAINTAINER",
  "ONBUILD",
  "RUN",
  "SHELL",
  "STOPSIGNAL",
  "USER",
  "VOLUME",
  "WORKDIR",
]);
const KNOWN_RUN_FLAGS = new Set(["device", "mount", "network", "security"]);
const INSTRUCTION_PATTERN = /^([A-Za-z]+)(?:[ \t]+(.*))?$/s;
const DIRECTIVE_PATTERN = /^\s*#\s*(escape|syntax)\s*=\s*(\S+)/gim;
const FLAG_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;
const SCP_GIT_SOURCE_PATTERN = /^git@[^:/\s]+:.+/;
const LINE_SEPARATOR_PATTERN = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/;

class AnalysisFallback extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

class ParseError extends Error {}

export type DockerfileSourceAnalysis = { groups: string[][]; fallbackReason: string };

/** Python `str.strip()` semantics: a UTF-8 BOM is not whitespace and must not be trimmed. */
const stripWhitespace = (value: string): string =>
  value.replace(/^(?:(?!\ufeff)\s)+|(?:(?!\ufeff)\s)+$/g, "");

/** POSIX `shlex.split` word splitting. */
export const shlexSplit = (value: string): string[] => {
  const words: string[] = [];
  let current = "";
  let inWord = false;
  let quote: '"' | "'" | null = null;
  let index = 0;
  while (index < value.length) {
    const character = value[index];
    index += 1;
    if (quote === "'") {
      if (character === "'") {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }
    if (quote === '"') {
      if (character === '"') {
        quote = null;
      } else if (character === "\\") {
        if (index >= value.length) {
          throw new ParseError("No escaped character");
        }
        const escaped = value[index];
        index += 1;
        if (escaped === '"' || escaped === "\\") {
          current += escaped;
        } else {
          current += "\\" + escaped;
        }
      } else {
        current += character;
      }
      continue;
    }
    if (character === "\\") {
      if (index >= value.length) {
        throw new ParseError("No escaped character");
      }
      current += value[index];
      index += 1;
      inWord = true;
    } else if (character === '"' || character === "'") {
      quote = character;
      inWord = true;
    } else if (/\s/.test(character)) {
      if (inWord) {
        words.push(current);
        current = "";
        inWord = false;
      }
    } else {
      current += character;
      inWord = true;
    }
  }
  if (quote !== null) {
    throw new ParseError("No closing quotation");
  }
  if (inWord) {
    words.push(current);
  }
  return words;
};

const isOfficialDockerfileFrontend = (reference: string): boolean => {
  let normalized = reference.trim();
  if (normalized.startsWith("docker-image://")) {
    normalized = normalized.slice("docker-image://".length);
  }
  normalized = normalized.split("@", 1)[0];
  const lastSlash = normalized.lastIndexOf("/");
  const lastColon = normalized.lastIndexOf(":");
  if (lastColon > lastSlash) {
    normalized = normalized.slice(0, lastColon);
  }
  return new Set([
    "docker/dockerfile",
    "docker.io/docker/dockerfile",
    "index.docker.io/docker/dockerfile",
    "docker/dockerfile-upstream",
    "docker.io/docker/dockerfile-upstream",
    "index.docker.io/docker/dockerfile-upstream",
  ]).has(normalized);
};

const isRemoteAddSource = (source: string): boolean => {
  if (SCP_GIT_SOURCE_PATTERN.test(source)) {
    return true;
  }
  return ["http://", "https://", "git://", "ssh://"].some((prefix) => source.startsWith(prefix));
};

const sourceHasPattern = (source: string): boolean =>
  source.includes("*") || source.includes("?") || source.includes("[");

const takeWord = (value: string): [string, string] => {
  let quote: string | null = null;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote !== null) {
      if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (/\s/.test(character)) {
      return [value.slice(0, index), value.slice(index)];
    }
  }
  if (quote !== null || escaped) {
    throw new ParseError("unterminated Dockerfile instruction word");
  }
  return [value, ""];
};

const splitLeadingFlags = (body: string): [Array<[string, string]>, string] => {
  const flags: Array<[string, string]> = [];
  let remaining = body.trimStart();
  while (remaining.startsWith("--")) {
    const [rawToken, rest] = takeWord(remaining);
    remaining = rest;
    const decoded = shlexSplit(rawToken);
    if (decoded.length !== 1 || !decoded[0].startsWith("--")) {
      throw new ParseError("invalid Dockerfile instruction flag");
    }
    const flag = decoded[0].slice(2);
    const separator = flag.indexOf("=");
    const key = (separator === -1 ? flag : flag.slice(0, separator)).toLowerCase();
    const value = separator === -1 ? "" : flag.slice(separator + 1);
    if (!FLAG_NAME_PATTERN.test(key)) {
      throw new ParseError("invalid Dockerfile instruction flag");
    }
    if (key === "mount" && (rawToken.includes('"') || rawToken.includes("'"))) {
      // BuildKit parses mount values as CSV after Dockerfile word processing.
      // Quoted CSV values are deliberately outside the subset implemented here.
      throw new ParseError("quoted RUN mount requires full context");
    }
    flags.push([key, value]);
    remaining = remaining.trimStart();
  }
  return [flags, remaining];
};

const parseCopyAddValues = (body: string): [Map<string, string>, string[]] => {
  const [parsedFlags, remaining] = splitLeadingFlags(body);
  const flags = new Map(parsedFlags);
  let values: string[];
  if (remaining.startsWith("[")) {
    const parsed: unknown = JSON.parse(remaining);
    if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === "string")) {
      throw new ParseError("invalid JSON COPY/ADD");
    }
    values = parsed;
  } else {
    if (remaining.includes("\\")) {
      // BuildKit's shell-form COPY/ADD word splitting is not POSIX shlex.
      // Backslash-containing forms use the full context rather than risk
      // selecting a different set of sources.
      throw new ParseError("escaped shell COPY/ADD requires full context");
    }
    values = shlexSplit(remaining);
  }
  if (values.length < 2) {
    throw new ParseError("COPY/ADD is missing source or destination");
  }
  return [flags, values];
};

const parseMountOptions = (value: string): Map<string, string> => {
  const options = new Map<string, string>();
  for (const field of value.split(",")) {
    const separator = field.indexOf("=");
    const key = (separator === -1 ? field : field.slice(0, separator)).trim().toLowerCase();
    if (!key) {
      throw new AnalysisFallback("run_mount_parse_failed");
    }
    options.set(key, separator === -1 ? "" : field.slice(separator + 1).trim());
  }
  return options;
};

const parseInstruction = (line: string): [string, string] => {
  const match = INSTRUCTION_PATTERN.exec(line);
  if (match === null) {
    throw new AnalysisFallback("dockerfile_parse_failed");
  }
  return [match[1].toUpperCase(), match[2] || ""];
};

const validateParserDirectives = (text: string): void => {
  for (const match of text.matchAll(DIRECTIVE_PATTERN)) {
    const name = match[1].toLowerCase();
    const value = match[2];
    if (name === "escape" && value !== "\\") {
      throw new AnalysisFallback("dockerfile_parse_failed");
    }
    if (name === "syntax" && !isOfficialDockerfileFrontend(value)) {
      throw new AnalysisFallback("custom_dockerfile_frontend");
    }
  }
};

const logicalLines = (text: string): string[] => {
  const lines: string[] = [];
  let parts: string[] = [];
  const rawLines = text.split(LINE_SEPARATOR_PATTERN);
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") {
    rawLines.pop();
  }
  for (const rawLine of rawLines) {
    const stripped = stripWhitespace(rawLine);
    if (parts.length === 0 && (!stripped || stripped.startsWith("#"))) {
      continue;
    }
    if (parts.length > 0 && (!stripped || stripped.startsWith("#"))) {
      // BuildKit has nuanced rules for comments and empty lines in a
      // continuation. Full context is the safe answer here.
      throw new AnalysisFallback("dockerfile_parse_failed");
    }
    if (stripped.endsWith("\\")) {
      parts.push(stripped.slice(0, -1).trimEnd());
      continue;
    }
    parts.push(stripped);
    lines.push(parts.join(" "));
    parts = [];
  }
  if (parts.length > 0) {
    throw new AnalysisFallback("dockerfile_parse_failed");
  }
  return lines;
};

const analyzeCopyOrAdd = (instruction: string, body: string): string[] => {
  let flags: Map<string, string>;
  let values: string[];
  try {
    [flags, values] = parseCopyAddValues(body);
  } catch (error) {
    if (error instanceof ParseError || error instanceof SyntaxError) {
      throw new AnalysisFallback("dockerfile_instruction_parse_failed");
    }
    throw error;
  }

  if (instruction === "COPY" && flags.has("from")) {
    return [];
  }

  const localSources: string[] = [];
  for (const source of values.slice(0, -1)) {
    if (source.includes("$") || source.includes("\x00")) {
      throw new AnalysisFallback(
        instruction === "COPY" ? "copy_source_requires_expansion" : "add_source_requires_expansion"
      );
    }
    if (source.includes("\\")) {
      // A backslash is a path character on Unix but a separator on Windows.
      // Full context keeps selection platform-independent.
      throw new AnalysisFallback("dockerfile_source_path");
    }
    if (instruction === "ADD" && isRemoteAddSource(source)) {
      continue;
    }
    if (sourceHasPattern(source)) {
      throw new AnalysisFallback("dockerfile_source_pattern");
    }
    localSources.push(source);
  }
  return localSources;
};

const analyzeRun = (body: string): string[][] => {
  let flags: Array<[string, string]>;
  try {
    [flags] = splitLeadingFlags(body);
  } catch (error) {
    if (error instanceof ParseError) {
      throw new AnalysisFallback("run_mount_parse_failed");
    }
    throw error;
  }

  const groups: string[][] = [];
  for (const [name, value] of flags) {
    if (!KNOWN_RUN_FLAGS.has(name)) {
      throw new AnalysisFallback("dockerfile_instruction_parse_failed");
    }
    if (name !== "mount") {
      continue;
    }
    if (!value || value.includes('"') || value.includes("'")) {
      throw new AnalysisFallback("run_mount_parse_failed");
    }
    const options = parseMountOptions(value);
    if ((options.get("type") ?? "bind") !== "bind" || options.get("from")) {
      continue;
    }
    const source = options.get("source") || options.get("src") || ".";
    if (source.includes("$") || source.includes("\x00")) {
      throw new AnalysisFallback("run_bind_source_requires_expansion");
    }
    groups.push([source]);
  }
  return groups;
};

const analyzeLines = (lines: string[]): string[][] => {
  const groups: string[][] = [];
  for (const line of lines) {
    const [instruction, body] = parseInstruction(line);
    if (!KNOWN_INSTRUCTIONS.has(instruction)) {
      throw new AnalysisFallback("dockerfile_instruction_parse_failed");
    }
    if (instruction === "COPY" || instruction === "ADD") {
      const group = analyzeCopyOrAdd(instruction, body);
      if (group.length > 0) {
        groups.push(group);
      }
    } else if (instruction === "RUN") {
      groups.push(...analyzeRun(body));
    }
  }
  return groups;
};

/** Return local source groups or a reason to upload the full context. */
export const analyzeDockerfileSources = (data: Buffer): DockerfileSourceAnalysis => {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data);
  } catch {
    return { groups: [], fallbackReason: "dockerfile_parse_failed" };
  }

  try {
    validateParserDirectives(text);
    // Heredocs are valid BuildKit syntax, but treating the entire Dockerfile
    // as full context is safer than partially parsing them.
    if (text.includes("<<")) {
      throw new AnalysisFallback("dockerfile_instruction_parse_failed");
    }
    return { groups: analyzeLines(logicalLines(text)), fallbackReason: "" };
  } catch (error) {
    if (error instanceof AnalysisFallback) {
      return { groups: [], fallbackReason: error.reason };
    }
    throw error;
  }
};
