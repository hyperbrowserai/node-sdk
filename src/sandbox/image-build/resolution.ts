/** Shared identity and validation for opt-in image resolution. */

import { HyperbrowserError } from "../../error";
import { SandboxImageBuild, SandboxImageInit } from "../../types/sandbox";
import { blake2b } from "./blake2b";
import { compactJson, isRecord } from "./common";

export type ImageBuildSource = "dockerfile" | "prebuilt";

export interface ImageBuildNameOptions {
  source: ImageBuildSource;
  fingerprint: string;
  namePrefix?: string;
  platform?: string;
  imageInit?: SandboxImageInit;
  imageConfigUser?: string;
}

const normalizeInitEnv = (env: Record<string, string> | undefined) =>
  env === undefined ? undefined : env;

/** Drop undefined/null fields so identity matches `exclude_none` serialization. */
export const normalizeImageInit = (
  imageInit: SandboxImageInit | undefined
): SandboxImageInit | undefined => {
  if (imageInit === undefined) {
    return undefined;
  }
  const normalized: SandboxImageInit = {};
  const env = normalizeInitEnv(imageInit.env);
  if (env !== undefined && env !== null) {
    normalized.env = env;
  }
  if (imageInit.command !== undefined && imageInit.command !== null) {
    normalized.command = imageInit.command;
  }
  if (imageInit.args !== undefined && imageInit.args !== null) {
    normalized.args = imageInit.args;
  }
  if (imageInit.workingDir !== undefined && imageInit.workingDir !== null) {
    normalized.workingDir = imageInit.workingDir;
  }
  return normalized;
};

/**
 * Name an immutable input identity without packaging or uploading it.
 *
 * Fingerprints identify effective Dockerfile contexts or platform-specific
 * Docker image digests. Builder resources and wait policies do not change the
 * image contents and are excluded. Mutable external inputs (base tags, network
 * downloads) require an explicit `forceBuild` to request another build.
 */
export const imageBuildName = (options: ImageBuildNameOptions): string => {
  const platform = (options.platform ?? "linux/amd64").trim().toLowerCase();
  const namePrefix = options.namePrefix ?? "hb";
  if (!/^[a-z0-9]+\/[a-z0-9]+(?:\/[a-z0-9]+)?$/.test(platform)) {
    throw new Error("platform must be an OCI platform such as 'linux/amd64'");
  }
  if (!/^[A-Za-z0-9_-]{1,21}$/.test(namePrefix)) {
    throw new Error("imageNamePrefix must be 1-21 letters, digits, '_' or '-'");
  }
  let payload: string;
  if (options.source === "prebuilt") {
    const fingerprint = options.fingerprint.toLowerCase();
    if (!/^sha256:[0-9a-f]{64}$/.test(fingerprint)) {
      throw new Error("expectedImageDigest must be a sha256: Docker digest");
    }
    payload = `docker_image\0${fingerprint}\0platform\0${platform}`;
  } else if (options.source === "dockerfile") {
    if (!/^[0-9a-f]{64}$/.test(options.fingerprint)) {
      throw new Error("expectedContextFingerprint must be a SHA-256 hex digest");
    }
    payload = `dockerfile-context-v3\0${options.fingerprint}\0platform\0${platform}`;
  } else {
    throw new Error("source must be 'dockerfile' or 'prebuilt'");
  }
  const identityOptions: Record<string, unknown> = {};
  const initialization = normalizeImageInit(options.imageInit);
  if (initialization !== undefined && Object.keys(initialization).length > 0) {
    identityOptions.imageInit = initialization;
  }
  if (options.imageConfigUser !== undefined) {
    identityOptions.imageConfigUser = options.imageConfigUser.trim();
  }
  if (Object.keys(identityOptions).length > 0) {
    payload += "\0options\0" + compactJson(identityOptions, { sortKeys: true });
  }
  const digest = blake2b(Buffer.from(payload, "utf8"), 8).toString("hex");
  const name = `${namePrefix}__${options.source}__${digest}__${platform.replace(/\//g, "-")}`;
  if (name.length > 64) {
    throw new Error("imageNamePrefix and platform produce a name longer than 64 characters");
  }
  return name;
};

const IMAGE_BUILD_STATUSES = new Set([
  "awaiting_upload",
  "upload_verified",
  "dispatching",
  "building",
  "verifying",
  "completed",
  "failed",
  "canceled",
]);

/** Return the compatible in-progress build described by a 409 conflict, if any. */
export const matchingImageBuild = (
  error: HyperbrowserError,
  imageName: string,
  inputFormat: string
): SandboxImageBuild | null => {
  if (error.statusCode !== 409 || error.code !== "image_build_in_progress") {
    return null;
  }
  if (!isRecord(error.details)) {
    return null;
  }
  const data = error.details.build;
  if (!isRecord(data)) {
    return null;
  }
  const metadata = data.metadata;
  if (!isRecord(metadata) || metadata.inputFormat !== inputFormat) {
    return null;
  }
  if ((metadata.sourcePlatform ?? "linux/amd64") !== "linux/amd64") {
    return null;
  }
  if (
    typeof data.id !== "string" ||
    !data.id ||
    typeof data.imageName !== "string" ||
    typeof data.status !== "string" ||
    !IMAGE_BUILD_STATUSES.has(data.status)
  ) {
    return null;
  }
  const build = data as unknown as SandboxImageBuild;
  if (build.imageName !== imageName) {
    return null;
  }
  return build;
};

export const completedImageId = (build: SandboxImageBuild): string | undefined => {
  if (build.status !== "completed") {
    return undefined;
  }
  if (!build.imageId) {
    throw new Error("Completed image build did not return an image ID");
  }
  return build.imageId;
};

export const isTerminalImageBuildStatus = (status: SandboxImageBuild["status"]): boolean =>
  status === "completed" || status === "failed" || status === "canceled";
