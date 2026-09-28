/**
 * Docker-compatible `.dockerignore` parsing and matching.
 *
 * The matching contract intentionally follows Moby `patternmatcher` v0.6.1,
 * which is also what the Hyperbrowser CLI reaches through BuildKit's
 * filesystem utilities.
 */

import { readFileSync } from "fs";
import { posixDirname, posixNormpath } from "./common";

const REGEX_META_WITHOUT_GLOB_MEANING = new Set(".+()|{}$");

/** Apply the Unix `filepath.Clean` behavior used by the CLI. */
const cleanPath = (value: string): string => {
  if (value.startsWith("//")) {
    value = "/" + value.replace(/^\/+/, "");
  }
  return posixNormpath(value);
};

/** Parse ignore-file lines like Moby's `ignorefile.ReadAll`. */
export const readIgnorePatterns = (text: string): string[] => {
  const patterns: string[] = [];
  text.split("\n").forEach((rawLine, index) => {
    if (rawLine.endsWith("\r")) {
      rawLine = rawLine.slice(0, -1);
    }
    if (index === 0 && rawLine.startsWith("\ufeff")) {
      rawLine = rawLine.slice(1);
    }
    if (rawLine.startsWith("#")) {
      return;
    }
    let value = rawLine.trim();
    if (!value) {
      return;
    }
    const exclusion = value.startsWith("!");
    if (exclusion) {
      value = value.slice(1).trim();
    }
    if (value) {
      value = cleanPath(value);
      if (value.length > 1 && value.startsWith("/")) {
        value = value.slice(1);
      }
    }
    patterns.push((exclusion ? "!" : "") + value);
  });
  return patterns;
};

type MatchType = "exact" | "prefix" | "suffix" | "regexp";

const validateCharacterClass = (pattern: string, cursor: number): number => {
  const consumeValue = (position: number): number => {
    if (position >= pattern.length || pattern[position] === "-" || pattern[position] === "]") {
      throw new Error(`invalid Docker ignore pattern "${pattern}"`);
    }
    if (pattern[position] === "\\") {
      position += 1;
      if (position >= pattern.length) {
        throw new Error(`invalid Docker ignore pattern "${pattern}"`);
      }
    }
    position += 1;
    if (position >= pattern.length) {
      throw new Error(`invalid Docker ignore pattern "${pattern}"`);
    }
    return position;
  };

  if (cursor < pattern.length && pattern[cursor] === "^") {
    cursor += 1;
  }
  let ranges = 0;
  while (true) {
    if (cursor < pattern.length && pattern[cursor] === "]" && ranges) {
      return cursor + 1;
    }
    cursor = consumeValue(cursor);
    if (cursor < pattern.length && pattern[cursor] === "-") {
      cursor = consumeValue(cursor + 1);
    }
    ranges += 1;
  }
};

/** Reject malformed patterns using Go filepath.Match's Unix grammar. */
const validateFilepathPattern = (pattern: string): void => {
  let cursor = 0;
  while (cursor < pattern.length) {
    const character = pattern[cursor];
    if (character === "\\") {
      cursor += 1;
      if (cursor === pattern.length) {
        throw new Error(`invalid Docker ignore pattern "${pattern}": trailing escape`);
      }
    } else if (character === "[") {
      cursor = validateCharacterClass(pattern, cursor + 1);
      continue;
    }
    cursor += 1;
  }
};

/** Compile one cleaned Moby pattern into its optimized match form. */
const compilePattern = (pattern: string): { matchType: MatchType; regexp: RegExp | null } => {
  const parts = ["^"];
  let matchType: MatchType = "exact";
  let cursor = 0;
  let tokenIndex = 0;
  while (cursor < pattern.length) {
    const character = pattern[cursor];
    cursor += 1;

    if (character === "*") {
      if (cursor < pattern.length && pattern[cursor] === "*") {
        cursor += 1;
        if (cursor < pattern.length && pattern[cursor] === "/") {
          cursor += 1;
        }

        if (cursor === pattern.length) {
          if (matchType === "exact") {
            matchType = "prefix";
          } else {
            parts.push(".*");
            matchType = "regexp";
          }
        } else {
          parts.push("(?:.*/)?");
          matchType = "regexp";
        }

        if (tokenIndex === 0) {
          matchType = "suffix";
        }
      } else {
        parts.push("[^/]*");
        matchType = "regexp";
      }
    } else if (character === "?") {
      parts.push("[^/]");
      matchType = "regexp";
    } else if (REGEX_META_WITHOUT_GLOB_MEANING.has(character)) {
      parts.push("\\" + character);
    } else if (character === "\\") {
      if (cursor < pattern.length) {
        parts.push("\\" + pattern[cursor]);
        cursor += 1;
        matchType = "regexp";
      } else {
        throw new Error(`invalid Docker ignore pattern "${pattern}": trailing escape`);
      }
    } else {
      // Brackets remain regex syntax because they are also filepath glob
      // syntax. All other characters are literal in the Moby compiler.
      parts.push(character);
      if (character === "[" || character === "]") {
        matchType = "regexp";
      }
    }

    tokenIndex += 1;
  }

  if (matchType !== "regexp") {
    return { matchType, regexp: null };
  }

  parts.push("$");
  try {
    return { matchType, regexp: new RegExp(parts.join("")) };
  } catch (error) {
    throw new Error(
      `invalid Docker ignore pattern "${pattern}": ${error instanceof Error ? error.message : error}`
    );
  }
};

class DockerIgnorePattern {
  readonly value: string;
  readonly exclusion: boolean;
  private readonly matchType: MatchType;
  private readonly regexp: RegExp | null;

  constructor(rawPattern: string) {
    let value = cleanPath(rawPattern.trim());
    const exclusion = value.startsWith("!");
    if (exclusion) {
      if (value === "!") {
        throw new Error('illegal exclusion pattern: "!"');
      }
      value = value.slice(1);
    }
    validateFilepathPattern(value);
    const compiled = compilePattern(value);
    this.value = value;
    this.exclusion = exclusion;
    this.matchType = compiled.matchType;
    this.regexp = compiled.regexp;
  }

  matchesPath(path: string): boolean {
    if (this.matchType === "exact") {
      return path === this.value;
    }
    if (this.matchType === "prefix") {
      return path.startsWith(this.value.slice(0, -2));
    }
    if (this.matchType === "suffix") {
      const suffix = this.value.slice(2);
      return path.endsWith(suffix) || (suffix.startsWith("/") && path === suffix.slice(1));
    }
    if (this.regexp === null) {
      throw new Error(`invalid Docker ignore pattern: "${this.value}"`);
    }
    return this.regexp.test(path);
  }
}

/** Ordered Docker ignore matcher with parent-directory semantics. */
export class DockerIgnoreMatcher {
  private readonly patterns: DockerIgnorePattern[];
  readonly hasNegations: boolean;

  constructor(patterns: Iterable<string>) {
    const compiled: DockerIgnorePattern[] = [];
    for (const pattern of patterns) {
      const cleaned = pattern.trim();
      if (!cleaned) {
        continue;
      }
      compiled.push(new DockerIgnorePattern(cleaned));
    }
    this.patterns = compiled;
    this.hasNegations = compiled.some((pattern) => pattern.exclusion);
  }

  static fromFile(path: string): DockerIgnoreMatcher {
    let text = readFileSync(path).toString("utf8");
    if (text.startsWith("\ufeff")) {
      text = text.slice(1);
    }
    return new DockerIgnoreMatcher(readIgnorePatterns(text));
  }

  static fromText(text: string): DockerIgnoreMatcher {
    return new DockerIgnoreMatcher(readIgnorePatterns(text));
  }

  matches(relativePath: string): boolean {
    // Traversal supplies slash-delimited paths. On Unix, a backslash can be
    // part of a filename and must remain available for glob escaping.
    const path = cleanPath(relativePath);
    if (path === ".") {
      return false;
    }

    const parent = posixDirname(path);
    const parentParts = parent && parent !== "." ? parent.split("/") : [];
    let matched = false;
    for (const pattern of this.patterns) {
      // An exclusion can only re-include an ignored path, and a normal pattern
      // only needs checking while the path is included.
      if (pattern.exclusion !== matched) {
        continue;
      }

      let patternMatches = pattern.matchesPath(path);
      if (!patternMatches) {
        for (let length = 1; length <= parentParts.length; length += 1) {
          if (pattern.matchesPath(parentParts.slice(0, length).join("/"))) {
            patternMatches = true;
            break;
          }
        }
      }

      if (patternMatches) {
        matched = !pattern.exclusion;
      }
    }

    return matched;
  }
}
