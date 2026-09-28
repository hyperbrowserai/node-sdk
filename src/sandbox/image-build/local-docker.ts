import { randomUUID } from "crypto";
import { existsSync } from "fs";
import * as path from "path";
import { IMAGE_BUILD_SOURCE_PLATFORM } from "./artifacts";
import { DockerCommandError, runDockerCommand } from "./docker-image";

export const makeTempDockerTag = (prefix = "hyperbrowser-sdk-build"): string =>
  `${prefix}:${randomUUID().replace(/-/g, "")}`;

export const removeDockerImage = async (image: string): Promise<void> => {
  try {
    await runDockerCommand(["image", "rm", image]);
  } catch (error) {
    if (!(error instanceof DockerCommandError)) {
      throw error;
    }
  }
};

export interface LocalDockerBuildOptions {
  contextPath: string;
  dockerfile?: string;
  tag: string;
  platform?: string;
  buildArgs?: Record<string, string>;
}

/** Build a Dockerfile locally with `docker buildx build --load`. */
export const buildDockerImageFromDockerfile = async (
  options: LocalDockerBuildOptions
): Promise<void> => {
  const context = options.contextPath;
  if (!existsSync(context)) {
    throw new Error(`Docker build context not found: ${context}`);
  }
  let dockerfilePath = options.dockerfile ?? "Dockerfile";
  if (!path.isAbsolute(dockerfilePath)) {
    dockerfilePath = path.join(context, dockerfilePath);
  }
  const args = [
    "buildx",
    "build",
    "--platform",
    options.platform ?? IMAGE_BUILD_SOURCE_PLATFORM,
    "-t",
    options.tag,
    "-f",
    dockerfilePath,
    "--load",
  ];
  for (const [key, value] of Object.entries(options.buildArgs ?? {})) {
    args.push("--build-arg", `${key}=${value}`);
  }
  args.push(context);
  await runDockerCommand(args);
};
