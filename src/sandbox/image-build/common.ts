/** Python `posixpath.normpath` semantics (keeps exactly two leading slashes). */
export const posixNormpath = (value: string): string => {
  if (value === "") {
    return ".";
  }
  let initialSlashes = value.startsWith("/") ? 1 : 0;
  if (initialSlashes && value.startsWith("//") && !value.startsWith("///")) {
    initialSlashes = 2;
  }
  const components: string[] = [];
  for (const component of value.split("/")) {
    if (component === "" || component === ".") {
      continue;
    }
    if (
      component !== ".." ||
      (!initialSlashes && components.length === 0) ||
      (components.length > 0 && components[components.length - 1] === "..")
    ) {
      components.push(component);
    } else if (components.length > 0) {
      components.pop();
    }
  }
  const joined = "/".repeat(initialSlashes) + components.join("/");
  return joined || ".";
};

export const posixDirname = (value: string): string => {
  const index = value.lastIndexOf("/") + 1;
  let head = value.slice(0, index);
  if (head && head !== "/".repeat(head.length)) {
    head = head.replace(/\/+$/, "");
  }
  return head;
};

export const posixJoin = (...parts: string[]): string => {
  let joined = "";
  for (const part of parts) {
    if (part.startsWith("/")) {
      joined = part;
    } else if (!joined || joined.endsWith("/")) {
      joined += part;
    } else {
      joined += "/" + part;
    }
  }
  return joined;
};

/** Compare strings by Unicode code point, like Python's default `str` ordering. */
export const compareCodePoints = (a: string, b: string): number => {
  const left = Array.from(a);
  const right = Array.from(b);
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index].codePointAt(0) ?? 0) - (right[index].codePointAt(0) ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return left.length - right.length;
};

const escapeNonAscii = (json: string): string =>
  json.replace(/[\u007f-\uffff]/g, (character) => {
    return "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0");
  });

// Serialize keys directly: assigning sorted keys to an object lets JavaScript
// reorder integer-like keys and treats __proto__ as a setter.
const sortedJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map((item) => sortedJson(item) ?? "null").join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record).sort(compareCodePoints).flatMap((key) => {
      const item = sortedJson(record[key]);
      return item === undefined ? [] : [`${JSON.stringify(key)}:${item}`];
    });
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
};

/**
 * Compact JSON matching Python `json.dumps(value, separators=(",", ":"))`.
 * `sortKeys` mirrors `sort_keys=True`; `ensureAscii` mirrors the default
 * `ensure_ascii=True` escaping of non-ASCII characters.
 */
export const compactJson = (
  value: unknown,
  options: { sortKeys?: boolean; ensureAscii?: boolean } = {}
): string => {
  const json = options.sortKeys ? sortedJson(value) : JSON.stringify(value);
  return options.ensureAscii === false ? json : escapeNonAscii(json);
};

export const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const requireRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value;
};

export const sleep = (seconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, seconds) * 1000));
