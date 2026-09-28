/** Remote Dockerfile build context selection, fingerprinting, and packaging. */

import { createHash, Hash } from "crypto";
import {
  createReadStream,
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  statSync,
  writeFileSync,
  Stats,
} from "fs";
import { homedir, tmpdir } from "os";
import * as path from "path";
import {
  SandboxBuildContextBundle,
  SandboxBuildContextManifest,
  SandboxBuildContextMode,
} from "../../types/sandbox";
import {
  CONTEXT_MANIFEST_INPUT_FORMAT,
  DockerImageBuildArtifact,
  IMAGE_BUILD_SOURCE_PLATFORM,
  removeArtifact,
  removeWorkspace,
} from "./artifacts";
import {
  compactJson,
  compareCodePoints,
  posixDirname,
  posixJoin,
  posixNormpath,
  SHA256_HEX_PATTERN,
} from "./common";
import { analyzeDockerfileSources } from "./dockerfile-analysis";
import { DockerIgnoreMatcher } from "./dockerignore";
import { writeGzipTar } from "./gzip";
import { TarEntryInfo } from "./tar";

const MAX_CONTEXT_SOURCE_GROUPS = 511;
const MAX_CONTEXT_ENTRIES = 1_000_000;

/** The packaged context no longer matches the caller's cache fingerprint. */
export class DockerBuildContextChangedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DockerBuildContextChangedError";
  }
}

export interface PackagedDockerBuildContext {
  artifact: DockerImageBuildArtifact;
  manifest: SandboxBuildContextManifest;
  bundles: Record<string, DockerImageBuildArtifact>;
  workspace: string;
  fingerprint: string;
  cleanup(): void;
}

export interface DockerBuildContextOptions {
  dockerfile?: string;
  forceFullContext?: boolean;
}

interface DockerBuildContextSelection {
  root: string;
  dockerfile: string;
  mode: SandboxBuildContextMode;
  fallbackReason: string | null;
  entryGroups: Array<Set<string>>;
}

const selectionFingerprint = (
  selection: DockerBuildContextSelection,
  bundleHashes: string[]
): string => {
  // Hash entry metadata and contents, not transport encoding: cache identity
  // must not depend on tar headers or a compression library.
  const identity = {
    version: 1,
    dockerfile: selection.dockerfile,
    contextMode: selection.mode,
    bundles: Array.from(new Set(bundleHashes)).sort(compareCodePoints),
  };
  return createHash("sha256")
    .update(compactJson(identity, { sortKeys: true }))
    .digest("hex");
};

const expandUser = (value: string): string => {
  if (value === "~" || value.startsWith("~/")) {
    return path.join(homedir(), value.slice(1));
  }
  return value;
};

const lstatOrNull = (target: string): Stats | null => {
  try {
    return lstatSync(target);
  } catch {
    return null;
  }
};

const statOrNull = (target: string): Stats | null => {
  try {
    return statSync(target);
  } catch {
    return null;
  }
};

const pathExistsOrSymlink = (target: string): boolean => lstatOrNull(target) !== null;

const pathIsWithin = (parent: string, candidate: string): boolean => {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const cleanContextRelativePath = (value: string | undefined, fallback: string): string => {
  let normalized = (value ?? "").trim() || fallback;
  normalized = normalized.split(path.sep).join("/");
  if (
    normalized.includes("\\") ||
    normalized.includes("\x00") ||
    normalized.includes("\r") ||
    normalized.includes("\n") ||
    normalized.startsWith("/")
  ) {
    throw new Error("Dockerfile path must be relative to the build context");
  }
  if (normalized.split("/").includes("..")) {
    throw new Error("Dockerfile path must be a relative path inside the build context");
  }
  const cleaned = posixNormpath(normalized);
  if (cleaned === "." || cleaned === ".." || cleaned.startsWith("../")) {
    throw new Error("Dockerfile path must be a relative path inside the build context");
  }
  return cleaned;
};

const selectDockerignore = (contextRoot: string, dockerfileRelative: string): string => {
  const dockerfileIgnore = `${dockerfileRelative}.dockerignore`;
  const candidate = path.join(contextRoot, dockerfileIgnore);
  if (existsSync(candidate)) {
    if (!statSync(candidate).isFile()) {
      throw new Error(
        `Dockerfile-specific ignore file "${dockerfileIgnore}" is not a regular file`
      );
    }
    return dockerfileIgnore;
  }
  return ".dockerignore";
};

export const loadDockerignore = (ignorePath: string): DockerIgnoreMatcher | null => {
  if (!existsSync(ignorePath)) {
    return null;
  }
  try {
    return DockerIgnoreMatcher.fromFile(ignorePath);
  } catch (error) {
    throw new Error(`parse .dockerignore: ${error instanceof Error ? error.message : error}`);
  }
};

const normalizeContextSource = (source: string): string => {
  if (source.includes("\x00")) {
    throw new Error("Dockerfile source path contains a NUL byte");
  }
  const normalized = String(source).trim().replace(/\\/g, "/");
  if (normalized === "" || normalized === "." || normalized === "/") {
    return ".";
  }
  return posixNormpath("/" + normalized).replace(/^\/+/, "") || ".";
};

const deduplicateSourceGroups = (groups: string[][]): string[][] => {
  const result: string[][] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    const normalized = group.map(normalizeContextSource).sort(compareCodePoints);
    const key = JSON.stringify(normalized);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(normalized);
    }
  }
  return result;
};

const isIgnored = (relative: string, matcher: DockerIgnoreMatcher | null): boolean =>
  matcher !== null && matcher.matches(relative);

const addContextEntryWithParents = (entries: Set<string>, relative: string): void => {
  let current = relative;
  while (current !== "" && current !== ".") {
    entries.add(current);
    current = posixDirname(current);
  }
};

const toRelative = (contextRoot: string, target: string): string => {
  const relative = path.relative(contextRoot, target).split(path.sep).join("/");
  return relative === "" ? "." : relative;
};

/**
 * Return a sparse source plus symlinks and their in-context targets.
 *
 * This mirrors fsutil `FollowPaths`: symlink targets are interpreted inside
 * the context root, including absolute or `..` targets, and cycles terminate
 * after retaining every symlink encountered.
 */
const followContextSourceSymlinks = (contextRoot: string, relativeSource: string): string[] => {
  const pending = [normalizeContextSource(relativeSource)];
  const resolved: string[] = [];
  const seen = new Set<string>();
  while (pending.length > 0) {
    const relative = pending.pop() as string;
    if (seen.has(relative)) {
      continue;
    }
    seen.add(relative);

    const parts = relative === "." ? [] : relative.split("/");
    const currentParts: string[] = [];
    let followed = false;
    for (let index = 0; index < parts.length; index += 1) {
      currentParts.push(parts[index]);
      const currentRelative = currentParts.join("/");
      const currentPath = path.join(contextRoot, currentRelative);
      const metadata = lstatOrNull(currentPath);
      if (metadata === null || !metadata.isSymbolicLink()) {
        continue;
      }

      resolved.push(currentRelative);
      let target: string;
      try {
        target = readlinkSync(currentPath);
      } catch (error) {
        throw new Error(
          `read build context symlink "${currentRelative}": ${error instanceof Error ? error.message : error}`
        );
      }
      if (!target || target.includes("\x00")) {
        throw new Error(`build context symlink "${currentRelative}" has an invalid target`);
      }

      const remainder = parts.slice(index + 1);
      const combined = target.startsWith("/")
        ? posixJoin(target, ...remainder)
        : posixJoin(posixDirname(currentRelative), target, ...remainder);
      const normalizedTarget = posixNormpath("/" + combined).replace(/^\/+/, "");
      pending.push(normalizedTarget || ".");
      followed = true;
      break;
    }

    if (!followed) {
      resolved.push(relative);
    }
  }
  return resolved;
};

const walkDirectory = (
  contextRoot: string,
  directory: string,
  entries: Set<string>,
  ignoreMatcher: DockerIgnoreMatcher | null,
  canPruneIgnoredDirectories: boolean
): void => {
  const children = readdirSync(directory, { withFileTypes: true });
  const directories = children
    .filter((child) => child.isDirectory())
    .map((child) => child.name)
    .sort(compareCodePoints);
  const files = children
    .filter((child) => !child.isDirectory())
    .map((child) => child.name)
    .sort(compareCodePoints);

  const retainedDirectories: string[] = [];
  for (const name of directories) {
    const childRelative = toRelative(contextRoot, path.join(directory, name));
    if (isIgnored(childRelative, ignoreMatcher)) {
      if (!canPruneIgnoredDirectories) {
        retainedDirectories.push(name);
      }
      continue;
    }
    addContextEntryWithParents(entries, childRelative);
    retainedDirectories.push(name);
  }
  for (const name of files) {
    const childRelative = toRelative(contextRoot, path.join(directory, name));
    if (isIgnored(childRelative, ignoreMatcher)) {
      continue;
    }
    addContextEntryWithParents(entries, childRelative);
  }
  for (const name of retainedDirectories) {
    walkDirectory(
      contextRoot,
      path.join(directory, name),
      entries,
      ignoreMatcher,
      canPruneIgnoredDirectories
    );
  }
};

const collectContextPath = (
  contextRoot: string,
  target: string,
  entries: Set<string>,
  ignoreMatcher: DockerIgnoreMatcher | null
): void => {
  const relative = toRelative(contextRoot, target);
  const pathIsIgnored = relative !== "." && isIgnored(relative, ignoreMatcher);
  const canPruneIgnoredDirectories = !(ignoreMatcher?.hasNegations ?? false);
  if (relative !== "." && !pathIsIgnored) {
    addContextEntryWithParents(entries, relative);
  }
  const metadata = lstatOrNull(target);
  if (metadata === null || metadata.isSymbolicLink() || !metadata.isDirectory()) {
    return;
  }
  if (pathIsIgnored && canPruneIgnoredDirectories) {
    return;
  }
  walkDirectory(contextRoot, target, entries, ignoreMatcher, canPruneIgnoredDirectories);
};

export const collectContextEntries = (
  contextRoot: string,
  sources: string[],
  options: { ignoreMatcher: DockerIgnoreMatcher | null; required: boolean }
): Set<string> => {
  const entries = new Set<string>();
  for (const rawSource of sources) {
    const source = normalizeContextSource(rawSource);
    const candidate = source === "." ? contextRoot : path.join(contextRoot, source);
    const existingMatches = pathExistsOrSymlink(candidate) ? [candidate] : [];
    if (options.required && existingMatches.length === 0) {
      throw new Error(`Docker build context source not found: "${source}"`);
    }
    for (const match of existingMatches) {
      const relativeMatch = toRelative(contextRoot, match);
      for (const followedRelative of followContextSourceSymlinks(contextRoot, relativeMatch)) {
        const followedPath =
          followedRelative === "." ? contextRoot : path.join(contextRoot, followedRelative);
        if (pathExistsOrSymlink(followedPath)) {
          collectContextPath(contextRoot, followedPath, entries, options.ignoreMatcher);
        }
      }
    }
  }
  return entries;
};

const isSubset = (left: Set<string>, right: Set<string>): boolean => {
  for (const item of left) {
    if (!right.has(item)) {
      return false;
    }
  }
  return true;
};

const removeSubsumedEntryGroups = (groups: Array<Set<string>>): Array<Set<string>> => {
  const result: Array<Set<string>> = [];
  groups.forEach((entries, index) => {
    const subsumed = groups.some((candidate, candidateIndex) => {
      if (index === candidateIndex || !isSubset(entries, candidate)) {
        return false;
      }
      const equal = entries.size === candidate.size;
      return !equal || index > candidateIndex;
    });
    if (!subsumed) {
      result.push(entries);
    }
  });
  return result;
};

const selectDockerBuildContext = (
  contextPath: string,
  options: DockerBuildContextOptions
): DockerBuildContextSelection => {
  const dockerfile = options.dockerfile ?? "Dockerfile";
  const contextRoot = realpathSync(path.resolve(expandUser(contextPath)));
  if (!statSync(contextRoot).isDirectory()) {
    throw new Error("Docker build context must be a directory");
  }
  const dockerfileRelative = cleanContextRelativePath(dockerfile, "Dockerfile");
  const dockerfilePath = path.join(contextRoot, dockerfileRelative);
  const dockerfileMetadata = lstatOrNull(dockerfilePath);
  const dockerfileStat = statOrNull(dockerfilePath);
  if (
    dockerfileMetadata === null ||
    !((dockerfileStat?.isFile() ?? false) || dockerfileMetadata.isSymbolicLink())
  ) {
    throw new Error(`Dockerfile "${dockerfileRelative}" must be a regular file or symlink`);
  }
  let resolvedDockerfile: string;
  try {
    resolvedDockerfile = realpathSync(dockerfilePath);
  } catch {
    throw new Error(
      `Dockerfile "${dockerfileRelative}" must resolve to a regular file inside the build context`
    );
  }
  if (!statSync(resolvedDockerfile).isFile() || !pathIsWithin(contextRoot, resolvedDockerfile)) {
    throw new Error(
      `Dockerfile "${dockerfileRelative}" must resolve to a regular file inside the build context`
    );
  }

  const dockerfileBytes = readFileSync(dockerfilePath);
  const ignoreRelative = selectDockerignore(contextRoot, dockerfileRelative);
  const ignoreMatcher = loadDockerignore(path.join(contextRoot, ignoreRelative));
  let { groups: sourceGroups, fallbackReason } = analyzeDockerfileSources(dockerfileBytes);
  if (options.forceFullContext) {
    sourceGroups = [];
    fallbackReason = "requested_full_context";
  }
  sourceGroups = deduplicateSourceGroups(sourceGroups);
  if (sourceGroups.length > MAX_CONTEXT_SOURCE_GROUPS) {
    sourceGroups = [];
    fallbackReason = "too_many_context_source_groups";
  }
  const usesWholeContext = sourceGroups.some((group) => group.includes("."));

  let contextMode: SandboxBuildContextMode = fallbackReason || usesWholeContext ? "full" : "sparse";
  const controlSources = [
    dockerfileRelative,
    ignoreRelative,
    toRelative(contextRoot, resolvedDockerfile),
  ];

  const collectFullContext = (): Array<Set<string>> => [
    new Set([
      ...collectContextEntries(contextRoot, ["."], { ignoreMatcher, required: false }),
      ...collectContextEntries(contextRoot, controlSources, {
        ignoreMatcher: null,
        required: false,
      }),
    ]),
  ];

  let entryGroups: Array<Set<string>>;
  if (contextMode === "full") {
    entryGroups = collectFullContext();
  } else {
    entryGroups = [
      collectContextEntries(contextRoot, controlSources, { ignoreMatcher: null, required: false }),
    ];
    for (const group of sourceGroups) {
      entryGroups.push(
        collectContextEntries(contextRoot, group, { ignoreMatcher, required: true })
      );
    }
    const total = entryGroups.reduce((sum, entries) => sum + entries.size, 0);
    if (total > MAX_CONTEXT_ENTRIES) {
      contextMode = "full";
      fallbackReason = "context_selection_too_large";
      entryGroups = collectFullContext();
    }
  }

  return {
    root: contextRoot,
    dockerfile: dockerfileRelative,
    mode: contextMode,
    fallbackReason: fallbackReason || null,
    entryGroups: removeSubsumedEntryGroups(entryGroups),
  };
};

const validateArchiveRelativePath = (relative: string): void => {
  if (
    !relative ||
    relative.startsWith("/") ||
    relative.includes("\x00") ||
    posixNormpath(relative) !== relative ||
    relative === ".." ||
    relative.startsWith("../")
  ) {
    throw new Error(`invalid build context path "${relative}"`);
  }
};

const contextEntryInfo = (contextRoot: string, relative: string): TarEntryInfo | null => {
  validateArchiveRelativePath(relative);
  const absolute = path.join(contextRoot, relative);
  // Every regular path must be present with its own contents (no hard-link
  // entries); preserve symlinks without following them.
  const metadata = lstatSync(absolute);
  const mode = metadata.mode & 0o7777;
  if (metadata.isFile()) {
    return { name: relative, type: "file", mode, size: metadata.size, linkname: "" };
  }
  if (metadata.isDirectory()) {
    return { name: `${relative}/`, type: "directory", mode, size: 0, linkname: "" };
  }
  if (metadata.isSymbolicLink()) {
    const linkname = readlinkSync(absolute);
    if (!linkname) {
      throw new Error(`build context symlink "${relative}" has an invalid target`);
    }
    return { name: relative, type: "symlink", mode, size: 0, linkname };
  }
  return null;
};

const hashContextEntryMetadata = (hasher: Hash, info: TarEntryInfo): void => {
  const metadata = Buffer.from(
    compactJson([
      info.type === "directory" ? info.name.replace(/\/+$/, "") : info.name,
      info.type,
      info.mode,
      info.size,
      info.linkname,
    ]),
    "utf8"
  );
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(metadata.length));
  hasher.update(length);
  hasher.update(metadata);
};

async function* hashingFileChunks(
  filePath: string,
  hasher: Hash,
  size: number
): AsyncGenerator<Buffer> {
  let remaining = size;
  if (remaining === 0) {
    return;
  }
  const stream = createReadStream(filePath, { highWaterMark: 64 * 1024 });
  try {
    for await (const chunk of stream) {
      const buffer = chunk as Buffer;
      if (buffer.length > remaining) {
        throw new Error(`build context file "${filePath}" changed size while reading`);
      }
      remaining -= buffer.length;
      hasher.update(buffer);
      yield buffer;
    }
  } finally {
    stream.destroy();
  }
  if (remaining !== 0) {
    throw new Error(`build context file "${filePath}" was truncated`);
  }
}

/**
 * Fingerprint the effective remote context without compressing or staging it.
 *
 * Uses the same Dockerfile source selection, ignore rules, and normalized tar
 * entries as remote packaging. Pass the result as `expectedContextFingerprint`
 * when building to detect context changes. Build options outside the context
 * (e.g. platform or imageInit) must also be included in the caller's cache
 * key. Mutable base tags and network resources are not resolved.
 */
export const dockerBuildContextFingerprint = async (
  contextPath: string,
  options: DockerBuildContextOptions = {}
): Promise<string> => {
  const selection = selectDockerBuildContext(contextPath, options);
  const hashes: string[] = [];
  for (const entries of selection.entryGroups) {
    const hasher = createHash("sha256");
    for (const relative of Array.from(entries).sort(compareCodePoints)) {
      const info = contextEntryInfo(selection.root, relative);
      if (info === null) {
        continue;
      }
      hashContextEntryMetadata(hasher, info);
      if (info.type === "file") {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _chunk of hashingFileChunks(
          path.join(selection.root, relative),
          hasher,
          info.size
        )) {
          // hashing only
        }
      }
    }
    hashes.push(hasher.digest("hex"));
  }
  return selectionFingerprint(selection, hashes);
};

const packageContextBundle = async (
  contextRoot: string,
  entries: string[],
  workspace: string,
  index: number
): Promise<[DockerImageBuildArtifact, SandboxBuildContextBundle, string]> => {
  const bundlePath = path.join(workspace, `bundle-${String(index).padStart(4, "0")}.tar.gz`);
  const contextHasher = createHash("sha256");
  let entryCount = 0;
  let uncompressedSize = 0;
  const result = await writeGzipTar(bundlePath, async (writer) => {
    for (const relative of entries) {
      const info = contextEntryInfo(contextRoot, relative);
      if (info === null) {
        continue;
      }
      hashContextEntryMetadata(contextHasher, info);
      if (info.type === "file") {
        await writer.addEntry(
          info,
          hashingFileChunks(path.join(contextRoot, relative), contextHasher, info.size)
        );
        uncompressedSize += info.size;
      } else {
        await writer.addEntry(info);
      }
      entryCount += 1;
    }
  });
  const artifact: DockerImageBuildArtifact = {
    path: bundlePath,
    sha256Hex: result.sha256Hex,
    sizeBytes: result.sizeBytes,
    inputFormat: CONTEXT_MANIFEST_INPUT_FORMAT,
    sourcePlatform: IMAGE_BUILD_SOURCE_PLATFORM,
    imageConfigUser: "",
  };
  const descriptor: SandboxBuildContextBundle = {
    sha256: result.sha256Hex,
    sizeBytes: result.sizeBytes,
    uncompressedSizeBytes: uncompressedSize,
    entryCount,
  };
  return [artifact, descriptor, contextHasher.digest("hex")];
};

/** Serialize a manifest exactly as the Python SDK does (field order, no nulls). */
export const canonicalManifestJson = (value: unknown): Buffer =>
  Buffer.from(compactJson(value, { ensureAscii: false }), "utf8");

export const writeManifestArtifact = (
  workspace: string,
  filename: string,
  data: Buffer,
  inputFormat: DockerImageBuildArtifact["inputFormat"],
  extras: Pick<DockerImageBuildArtifact, "imageConfigUser" | "imageInit"> = {
    imageConfigUser: "",
  }
): DockerImageBuildArtifact => {
  const filePath = path.join(workspace, filename);
  writeFileSync(filePath, data, { flag: "wx" });
  return {
    path: filePath,
    sha256Hex: createHash("sha256").update(data).digest("hex"),
    sizeBytes: data.length,
    inputFormat,
    sourcePlatform: IMAGE_BUILD_SOURCE_PLATFORM,
    imageConfigUser: extras.imageConfigUser,
    imageInit: extras.imageInit,
  };
};

export interface PackageDockerBuildContextOptions extends DockerBuildContextOptions {
  tempDir?: string;
  expectedContextFingerprint?: string;
}

export const packageDockerBuildContextManifest = async (
  contextPath: string,
  options: PackageDockerBuildContextOptions = {}
): Promise<PackagedDockerBuildContext> => {
  const expected = options.expectedContextFingerprint;
  if (expected !== undefined && !SHA256_HEX_PATTERN.test(expected)) {
    throw new Error("expectedContextFingerprint must be a SHA-256 hex digest");
  }
  const selection = selectDockerBuildContext(contextPath, options);
  const workspace = mkdtempSync(path.join(options.tempDir ?? tmpdir(), "hb-docker-context-"));
  try {
    const bundles: Record<string, DockerImageBuildArtifact> = {};
    const descriptors: SandboxBuildContextBundle[] = [];
    const bundleHashes: string[] = [];
    for (const [index, entries] of selection.entryGroups.entries()) {
      const [artifact, descriptor, bundleHash] = await packageContextBundle(
        selection.root,
        Array.from(entries).sort(compareCodePoints),
        workspace,
        index
      );
      bundleHashes.push(bundleHash);
      if (descriptor.sha256 in bundles) {
        removeArtifact(artifact);
        continue;
      }
      bundles[descriptor.sha256] = artifact;
      descriptors.push(descriptor);
    }
    descriptors.sort((left, right) => compareCodePoints(left.sha256, right.sha256));
    const fingerprint = selectionFingerprint(selection, bundleHashes);
    if (expected !== undefined && fingerprint !== expected) {
      throw new DockerBuildContextChangedError(
        "Docker build context changed after its cache fingerprint was computed. " +
          "Retry the build with a fresh fingerprint."
      );
    }
    const manifest: SandboxBuildContextManifest = {
      version: 1,
      dockerfilePath: selection.dockerfile,
      contextMode: selection.mode,
      ...(selection.fallbackReason ? { fallbackReason: selection.fallbackReason } : {}),
      bundles: descriptors,
    };
    const artifact = writeManifestArtifact(
      workspace,
      "context-manifest.json",
      canonicalManifestJson(manifest),
      CONTEXT_MANIFEST_INPUT_FORMAT
    );
    return {
      artifact,
      manifest,
      bundles,
      workspace,
      fingerprint,
      cleanup: () => removeWorkspace(workspace),
    };
  } catch (error) {
    removeWorkspace(workspace);
    throw error;
  }
};
