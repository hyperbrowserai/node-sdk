/** Local Docker image inspection and layer-manifest packaging for prebuilt imports. */

import { execFile, spawn, ChildProcess } from "child_process";
import { createHash } from "crypto";
import { createWriteStream, mkdtempSync, readFileSync } from "fs";
import { once } from "events";
import { tmpdir } from "os";
import * as path from "path";
import { promisify } from "util";
import {
  SandboxDockerImageConfig,
  SandboxDockerImageLayer,
  SandboxDockerImageManifest,
  SandboxImageInit,
} from "../../types/sandbox";
import {
  DOCKER_IMAGE_MANIFEST_INPUT_FORMAT,
  DockerImageBuildArtifact,
  IMAGE_BUILD_SOURCE_PLATFORM,
  removeWorkspace,
} from "./artifacts";
import { isRecord, posixNormpath, requireRecord, SHA256_HEX_PATTERN } from "./common";
import { canonicalManifestJson, writeManifestArtifact } from "./context";
import { deriveAutoImageInit } from "./image-init";
import { readTarEntries } from "./tar";

const execFileAsync = promisify(execFile);

const MAX_DOCKER_SAVE_ENTRIES = 4096;
const MAX_DOCKER_SAVE_ARCHIVE_BYTES = 5 * 1024 * 1024 * 1024;
const MAX_DOCKER_SAVE_METADATA_BYTES = 16 * 1024 * 1024;
const MAX_DOCKER_IMAGE_LAYERS = 512;

export interface DockerImageManifestSource {
  imageDigest: string;
  config: Record<string, unknown>;
  imageConfigUser: string;
  imageInit?: SandboxImageInit;
  cleanup(): Promise<void>;
}

export interface PackagedDockerImage {
  artifact: DockerImageBuildArtifact;
  manifest: SandboxDockerImageManifest;
  layers: Record<string, DockerImageBuildArtifact>;
  workspace: string;
  cleanup(): void;
}

interface StoredDockerSaveEntry {
  path: string;
  sha256Hex: string;
  sizeBytes: number;
}

export class DockerCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DockerCommandError";
  }
}

const describeCommandFailure = (
  args: string[],
  error: NodeJS.ErrnoException & { stderr?: string | Buffer; code?: string | number }
): DockerCommandError => {
  if (error.code === "ENOENT") {
    return new DockerCommandError("docker CLI is required for local Docker image operations");
  }
  const stderr = String(error.stderr ?? "").trim();
  const command = ["docker", ...args].join(" ");
  if (stderr) {
    return new DockerCommandError(`${command}: ${stderr}`);
  }
  return new DockerCommandError(`${command} failed with code ${String(error.code ?? "unknown")}`);
};

export const runDockerCommand = async (args: string[]): Promise<string> => {
  try {
    const { stdout } = await execFileAsync("docker", args, {
      maxBuffer: MAX_DOCKER_SAVE_METADATA_BYTES,
      encoding: "utf8",
    });
    return stdout;
  } catch (error) {
    throw describeCommandFailure(args, error as NodeJS.ErrnoException);
  }
};

const normalizeSha256Digest = (value: unknown): string => {
  const digest = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!digest.startsWith("sha256:") || !SHA256_HEX_PATTERN.test(digest.slice(7))) {
    throw new Error("docker inspect returned an invalid linux/amd64 image digest");
  }
  return digest;
};

const unsupportedDockerImagePlatformError = (
  dockerImage: string,
  actualPlatform: string,
  expectedPlatform: string
): Error =>
  new Error(
    [
      "docker image platform is not supported for Hyperbrowser image builds: " +
        `${dockerImage} is ${actualPlatform} (expected ${expectedPlatform}).`,
      `Please rebuild the image for ${expectedPlatform} and try again:`,
      "  cd <docker-build-context-root>",
      `  docker buildx build --platform ${expectedPlatform} -t ${dockerImage} ` +
        "-f <path/to/Dockerfile> --load .",
    ].join("\n")
  );

const inspectDockerImage = async (
  dockerImage: string,
  platform: string
): Promise<Record<string, unknown>> => {
  const output = (
    await runDockerCommand([
      "image",
      "inspect",
      `--platform=${platform}`,
      "--format",
      "{{json .}}",
      dockerImage,
    ])
  ).trim();
  let inspection: unknown;
  try {
    inspection = JSON.parse(output);
  } catch {
    throw new Error("decode Docker image inspection");
  }
  if (!isRecord(inspection)) {
    throw new Error("docker inspect returned an invalid image inspection");
  }
  const actualPlatform = `${String(inspection.Os ?? "")}/${String(
    inspection.Architecture ?? ""
  )}`.toLowerCase();
  if (actualPlatform !== platform.trim().toLowerCase()) {
    throw unsupportedDockerImagePlatformError(dockerImage, actualPlatform, platform);
  }
  return inspection;
};

const inspectDockerContainerConfig = async (
  containerId: string
): Promise<Record<string, unknown>> => {
  const output = (
    await runDockerCommand(["container", "inspect", "--format", "{{json .Config}}", containerId])
  ).trim();
  if (!output || output === "null") {
    throw new Error("docker inspect returned empty container config");
  }
  try {
    return requireRecord(JSON.parse(output), "Docker container config");
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("decode Docker container config");
    }
    throw error;
  }
};

const removeDockerContainer = async (containerId: string): Promise<void> => {
  try {
    await runDockerCommand(["rm", "-f", containerId]);
  } catch (error) {
    if (!(error instanceof DockerCommandError)) {
      throw error;
    }
  }
};

/** Inspect platform identity with Docker API 1.49+, without temporary resources. */
export const dockerImageDigest = async (
  dockerImage: string,
  options: { platform?: string } = {}
): Promise<string> => {
  const platform = options.platform ?? IMAGE_BUILD_SOURCE_PLATFORM;
  let inspection: Record<string, unknown>;
  try {
    inspection = await inspectDockerImage(dockerImage, platform);
  } catch (error) {
    if (error instanceof DockerCommandError) {
      const message = error.message;
      if (
        message.includes('"--platform" requires API version') ||
        message.includes("unknown flag: --platform")
      ) {
        throw new Error(
          "Local Docker image imports require a Docker CLI and Engine supporting API 1.49 " +
            "or newer (Docker 28.1+). Upgrade Docker or remove an older DOCKER_API_VERSION override."
        );
      }
    }
    throw error;
  }
  return normalizeSha256Digest(inspection.Id);
};

const manifestSource = (
  imageDigest: string,
  config: Record<string, unknown>,
  cleanup: () => Promise<void>
): DockerImageManifestSource => ({
  imageDigest,
  config,
  imageConfigUser: String(config.User ?? "").trim(),
  imageInit: deriveAutoImageInit(config),
  cleanup,
});

export const prepareDockerImageManifestSource = async (
  dockerImage: string,
  options: { platform?: string } = {}
): Promise<DockerImageManifestSource> => {
  const platform = options.platform ?? IMAGE_BUILD_SOURCE_PLATFORM;
  try {
    const inspection = await inspectDockerImage(dockerImage, platform);
    return manifestSource(
      normalizeSha256Digest(inspection.Id),
      requireRecord(inspection.Config, "Docker image config"),
      async () => undefined
    );
  } catch (error) {
    if (!(error instanceof DockerCommandError)) {
      throw error;
    }
  }

  const containerId = (
    await runDockerCommand(["create", `--platform=${platform}`, dockerImage])
  ).trim();
  if (!containerId) {
    throw new Error("docker create returned empty container ID");
  }
  try {
    const config = await inspectDockerContainerConfig(containerId);
    let digest: string;
    try {
      digest = await runDockerCommand([
        "image",
        "inspect",
        `--platform=${platform}`,
        "--format",
        "{{.Id}}",
        dockerImage,
      ]);
    } catch (error) {
      if (!(error instanceof DockerCommandError)) {
        throw error;
      }
      digest = await runDockerCommand([
        "container",
        "inspect",
        "--format",
        "{{.Image}}",
        containerId,
      ]);
    }
    return manifestSource(normalizeSha256Digest(digest), config, () =>
      removeDockerContainer(containerId)
    );
  } catch (error) {
    await removeDockerContainer(containerId);
    throw error;
  }
};

const normalizeDockerSaveEntryName = (raw: string): string => {
  if (
    !raw ||
    raw.includes("\\") ||
    raw.includes("\x00") ||
    raw.includes("\r") ||
    raw.includes("\n") ||
    raw.startsWith("/")
  ) {
    throw new Error("docker image save contains an unsafe entry path");
  }
  const normalized = posixNormpath(raw);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized !== raw
  ) {
    throw new Error("docker image save contains an unsafe entry path");
  }
  return normalized;
};

const storeStreamedEntry = async (
  source: AsyncIterable<Buffer>,
  destination: string,
  expectedSize: number,
  name: string
): Promise<StoredDockerSaveEntry> => {
  const hasher = createHash("sha256");
  const output = createWriteStream(destination, { flags: "wx" });
  let written = 0;
  try {
    for await (const chunk of source) {
      hasher.update(chunk);
      written += chunk.length;
      if (!output.write(chunk)) {
        await once(output, "drain");
      }
    }
    output.end();
    await once(output, "finish");
  } catch (error) {
    output.destroy();
    throw error;
  }
  if (written !== expectedSize) {
    throw new Error(`docker image save entry "${name}" has truncated content`);
  }
  return { path: destination, sha256Hex: hasher.digest("hex"), sizeBytes: written };
};

const parseJsonObject = (data: Buffer, label: string): Record<string, unknown> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  return requireRecord(parsed, label);
};

const resolveDockerSaveManifest = (
  entries: Map<string, StoredDockerSaveEntry>
): [StoredDockerSaveEntry, StoredDockerSaveEntry[]] => {
  const manifestEntry = entries.get("manifest.json");
  if (
    manifestEntry === undefined ||
    manifestEntry.sizeBytes <= 0 ||
    manifestEntry.sizeBytes > MAX_DOCKER_SAVE_METADATA_BYTES
  ) {
    throw new Error("docker image save manifest.json is missing or too large");
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(manifestEntry.path, "utf8"));
  } catch {
    throw new Error("docker image save manifest.json is invalid");
  }
  if (!Array.isArray(manifest) || manifest.length !== 1) {
    throw new Error("docker image save must contain exactly one manifest entry");
  }
  const item = requireRecord(manifest[0], "Docker save manifest entry");
  const configName = normalizeDockerSaveEntryName(String(item.Config ?? ""));
  const configEntry = entries.get(configName);
  if (
    configEntry === undefined ||
    configEntry.sizeBytes <= 0 ||
    configEntry.sizeBytes > MAX_DOCKER_SAVE_METADATA_BYTES
  ) {
    throw new Error("docker image save config is missing or too large");
  }
  const rawLayers = item.Layers;
  if (!Array.isArray(rawLayers) || rawLayers.length > MAX_DOCKER_IMAGE_LAYERS) {
    throw new Error("docker image save has too many layers");
  }
  const layers: StoredDockerSaveEntry[] = [];
  for (const rawLayer of rawLayers) {
    const layerName = normalizeDockerSaveEntryName(String(rawLayer));
    const layer = entries.get(layerName);
    if (layer === undefined || layer.sizeBytes <= 0) {
      throw new Error(`docker image save layer "${layerName}" is missing`);
    }
    layers.push(layer);
  }
  return [configEntry, layers];
};

const resolveOciImageDescriptor = (
  entries: Map<string, StoredDockerSaveEntry>,
  imageDigest: string,
  config: SandboxDockerImageConfig,
  layers: SandboxDockerImageLayer[]
): SandboxDockerImageConfig => {
  const digestHex = imageDigest.slice("sha256:".length);
  const entry = entries.get(`blobs/sha256/${digestHex}`);
  if (
    entry === undefined ||
    entry.sha256Hex !== digestHex ||
    entry.sizeBytes <= 0 ||
    entry.sizeBytes > MAX_DOCKER_SAVE_METADATA_BYTES
  ) {
    throw new Error("docker image save is missing its inspected OCI image manifest");
  }
  const data = readFileSync(entry.path);
  const descriptor = parseJsonObject(data, "OCI image manifest");
  if (descriptor.schemaVersion !== 2) {
    throw new Error("inspected Docker image descriptor is not a valid OCI image manifest");
  }
  const descriptorConfig = requireRecord(descriptor.config, "OCI config");
  if (
    descriptorConfig.digest !== `sha256:${config.sha256}` ||
    descriptorConfig.size !== config.sizeBytes
  ) {
    throw new Error("OCI image manifest config does not match Docker save config");
  }
  const descriptorLayers = descriptor.layers;
  if (!Array.isArray(descriptorLayers) || descriptorLayers.length !== layers.length) {
    throw new Error("OCI image manifest layer count does not match Docker save manifest");
  }
  descriptorLayers.forEach((rawLayer, index) => {
    const item = requireRecord(rawLayer, `OCI layer ${index}`);
    const layer = layers[index];
    if (item.digest !== `sha256:${layer.sha256}` || item.size !== layer.sizeBytes) {
      throw new Error(`OCI image manifest layer ${index} does not match Docker save manifest`);
    }
  });
  return {
    sha256: entry.sha256Hex,
    sizeBytes: entry.sizeBytes,
    dataBase64: data.toString("base64"),
  };
};

const terminateProcess = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  await once(child, "close");
  clearTimeout(timer);
};

export interface PackageDockerImageManifestOptions {
  platform?: string;
  tempDir?: string;
}

/** Stream `docker image save` into verified layer artifacts plus a manifest. */
export const packageDockerImageManifest = async (
  dockerImage: string,
  imageDigest: string,
  config: Record<string, unknown>,
  options: PackageDockerImageManifestOptions = {}
): Promise<PackagedDockerImage> => {
  const platform = options.platform ?? IMAGE_BUILD_SOURCE_PLATFORM;
  const normalizedDigest = normalizeSha256Digest(imageDigest);
  const workspace = mkdtempSync(path.join(options.tempDir ?? tmpdir(), "hb-docker-image-layers-"));
  let child: ChildProcess | null = null;
  try {
    const args = ["image", "save", `--platform=${platform}`, dockerImage];
    child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    const process = child;
    const stdout = process.stdout;
    if (!stdout || !process.stderr) {
      throw new Error("docker image save did not provide stdout");
    }
    let stderr = "";
    process.stderr.setEncoding("utf8");
    process.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    const exit = new Promise<number | null>((resolve, reject) => {
      process.on("error", (error: NodeJS.ErrnoException) =>
        reject(describeCommandFailure(args, error))
      );
      process.on("close", (code) => resolve(code));
    });
    exit.catch(() => undefined);

    const entries = new Map<string, StoredDockerSaveEntry>();
    let totalBytes = 0;
    let index = 0;
    const consume = async (): Promise<void> => {
      for await (const member of readTarEntries(stdout)) {
        if (index >= MAX_DOCKER_SAVE_ENTRIES) {
          throw new Error(
            `docker image save contains more than ${MAX_DOCKER_SAVE_ENTRIES} entries`
          );
        }
        const entryIndex = index;
        index += 1;
        if (!member.isFile) {
          continue;
        }
        const name = normalizeDockerSaveEntryName(member.name);
        if (entries.has(name)) {
          throw new Error(`docker image save contains duplicate entry "${name}"`);
        }
        totalBytes += member.size;
        if (member.size < 0 || totalBytes > MAX_DOCKER_SAVE_ARCHIVE_BYTES) {
          throw new Error("docker image save archive exceeds the size limit");
        }
        const destination = path.join(workspace, `entry-${String(entryIndex).padStart(4, "0")}`);
        entries.set(
          name,
          await storeStreamedEntry(member.content(), destination, member.size, name)
        );
      }
    };
    try {
      await consume();
    } catch (error) {
      await terminateProcess(process);
      throw error;
    }
    const returnCode = await exit;
    if (returnCode !== 0) {
      const message = stderr.trim();
      throw new Error(
        message
          ? `docker image save ${dockerImage} failed: ${message}`
          : `docker image save ${dockerImage} failed with code ${returnCode}`
      );
    }
    child = null;

    const [configEntry, layerEntries] = resolveDockerSaveManifest(entries);
    const configBytes = readFileSync(configEntry.path);
    parseJsonObject(configBytes, "Docker image config");
    const configDescriptor: SandboxDockerImageConfig = {
      sha256: configEntry.sha256Hex,
      sizeBytes: configEntry.sizeBytes,
      dataBase64: configBytes.toString("base64"),
    };
    const layerDescriptors: SandboxDockerImageLayer[] = [];
    const layers: Record<string, DockerImageBuildArtifact> = {};
    for (const layer of layerEntries) {
      layerDescriptors.push({ sha256: layer.sha256Hex, sizeBytes: layer.sizeBytes });
      const existing = layers[layer.sha256Hex];
      if (existing !== undefined && existing.sizeBytes !== layer.sizeBytes) {
        throw new Error(`Docker layer ${layer.sha256Hex} has conflicting sizes`);
      }
      if (existing === undefined) {
        layers[layer.sha256Hex] = {
          path: layer.path,
          sha256Hex: layer.sha256Hex,
          sizeBytes: layer.sizeBytes,
          inputFormat: DOCKER_IMAGE_MANIFEST_INPUT_FORMAT,
          sourcePlatform: platform,
          imageConfigUser: "",
        };
      }
    }

    const imageDescriptor =
      normalizedDigest !== `sha256:${configDescriptor.sha256}`
        ? resolveOciImageDescriptor(entries, normalizedDigest, configDescriptor, layerDescriptors)
        : undefined;
    const manifest: SandboxDockerImageManifest = {
      version: 1,
      imageDigest: normalizedDigest,
      ...(imageDescriptor ? { descriptor: imageDescriptor } : {}),
      config: configDescriptor,
      layers: layerDescriptors,
    };
    const artifact = writeManifestArtifact(
      workspace,
      "docker-image-manifest.json",
      canonicalManifestJson(manifest),
      DOCKER_IMAGE_MANIFEST_INPUT_FORMAT,
      {
        imageConfigUser: String(config.User ?? "").trim(),
        imageInit: deriveAutoImageInit(config),
      }
    );
    return {
      artifact,
      manifest,
      layers,
      workspace,
      cleanup: () => removeWorkspace(workspace),
    };
  } catch (error) {
    if (child !== null) {
      await terminateProcess(child);
    }
    removeWorkspace(workspace);
    throw error;
  }
};
