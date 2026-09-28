import fetch from "node-fetch";
import { createReadStream, statSync } from "fs";
import { PassThrough } from "stream";
import { SandboxImageBuildUpload } from "../../types/sandbox";
import { DockerImageBuildArtifact } from "./artifacts";
import { sleep } from "./common";

class UploadStatusError extends Error {
  constructor(
    readonly statusCode: number,
    body: string
  ) {
    super(`image artifact upload failed: ${statusCode}: ${body}`.trimEnd());
    this.name = "UploadStatusError";
  }
}

const uploadOnce = async (
  upload: SandboxImageBuildUpload,
  artifactPath: string,
  method: string,
  timeoutSeconds: number | null | undefined
): Promise<void> => {
  const size = statSync(artifactPath).size;
  const headers: Record<string, string> = { ...(upload.headers || {}) };
  if (!Object.keys(headers).some((key) => key.toLowerCase() === "content-length")) {
    headers["content-length"] = String(size);
  }

  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const resetTimer = () => {
    if (timeoutSeconds === null || timeoutSeconds === undefined) {
      return;
    }
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  };

  const source = createReadStream(artifactPath);
  const body = new PassThrough();
  source.on("data", () => resetTimer());
  source.on("error", (error) => body.destroy(error));
  source.pipe(body);
  resetTimer();

  try {
    const response = await fetch(upload.url, {
      method,
      headers,
      body: size === 0 ? undefined : body,
      signal: controller.signal,
    });
    resetTimer();
    const text = await response.text();
    if (response.ok) {
      return;
    }
    throw new UploadStatusError(response.status, text.trim());
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`image artifact upload timed out after ${timeoutSeconds}s of inactivity`);
    }
    throw error;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    source.destroy();
  }
};

export const uploadImageBuildArtifact = async (
  upload: SandboxImageBuildUpload,
  artifactPath: string,
  options: { timeout?: number | null } = {}
): Promise<void> => {
  const artifactSize = statSync(artifactPath).size;
  if (upload.maxUploadBytes > 0 && artifactSize > upload.maxUploadBytes) {
    throw new Error(
      `image artifact exceeds the server upload limit (${artifactSize} > ${upload.maxUploadBytes})`
    );
  }
  const method = (upload.method || "PUT").trim().toUpperCase();
  const attempts = method === "PUT" ? 3 : 1;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await uploadOnce(upload, artifactPath, method, options.timeout);
      return;
    } catch (error) {
      lastError = error;
      if (error instanceof UploadStatusError) {
        if (error.statusCode !== 408 && error.statusCode !== 429 && error.statusCode < 500) {
          throw error;
        }
      }
    }
    if (attempt < attempts) {
      await sleep(attempt * 0.25);
    }
  }
  throw lastError;
};

/** Upload only the artifacts the server requested, verifying each request. */
export const uploadMissingImageBuildArtifacts = async (
  uploads: SandboxImageBuildUpload[] | undefined,
  artifacts: Record<string, DockerImageBuildArtifact>,
  options: { label: string; timeout?: number | null }
): Promise<void> => {
  const requested: Array<[SandboxImageBuildUpload, DockerImageBuildArtifact, string]> = [];
  const seen = new Set<string>();
  for (const upload of uploads ?? []) {
    const digest = (upload.sha256 || "").trim().toLowerCase();
    const artifact = artifacts[digest];
    if (!digest || artifact === undefined) {
      throw new Error(`server requested unknown ${options.label} "${upload.sha256}"`);
    }
    if (seen.has(digest)) {
      throw new Error(`server requested duplicate ${options.label} ${digest}`);
    }
    seen.add(digest);
    const method = (upload.method || "PUT").trim().toUpperCase();
    if (method !== "PUT") {
      throw new Error(
        `server requested unsupported ${options.label} upload method "${upload.method}"`
      );
    }
    if (upload.maxUploadBytes > 0 && artifact.sizeBytes > upload.maxUploadBytes) {
      throw new Error(
        `${options.label} ${digest} exceeds the server upload limit ` +
          `(${artifact.sizeBytes} > ${upload.maxUploadBytes})`
      );
    }
    requested.push([upload, artifact, digest]);
  }
  if (requested.length === 0) {
    return;
  }

  let next = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed && next < requested.length) {
      const [upload, artifact, digest] = requested[next];
      next += 1;
      try {
        await uploadImageBuildArtifact(upload, artifact.path, { timeout: options.timeout });
      } catch (error) {
        failed = true;
        throw new Error(
          `upload ${options.label} ${digest}: ${error instanceof Error ? error.message : error}`
        );
      }
    }
  };
  const results = await Promise.allSettled(
    Array.from({ length: Math.min(4, requested.length) }, () => worker())
  );
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
};
