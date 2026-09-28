import { HyperbrowserError } from "../error";
import { SandboxFilesApi } from "../sandbox/files";
import { RuntimeConnection, RuntimeTransport } from "../sandbox/base";
import { runtimeSessionIdFromPath } from "../sandbox/runtime-path";
import { SandboxProcessHandle, SandboxProcessesApi } from "../sandbox/process";
import { SandboxTerminalApi } from "../sandbox/terminal";
import {
  buildDockerImageFromDockerfile,
  completedImageId,
  dockerBuildContextFingerprint,
  dockerImageDigest,
  DockerImageBuildArtifact,
  IMAGE_BUILD_SOURCE_PLATFORM,
  imageBuildName,
  makeTempDockerTag,
  matchingImageBuild,
  mergeImageInit,
  packageDockerBuildContextManifest,
  packageDockerImageManifest,
  prepareDockerImageManifestSource,
  removeDockerImage,
  uploadMissingImageBuildArtifacts,
} from "../sandbox/image-build";
import { BasicResponse } from "../types/session";
import {
  BuildSandboxImageFromDockerImageOptions,
  BuildSandboxImageFromDockerfileOptions,
  CompleteSandboxImageBuildParams,
  CreateSandboxImageBuildParams,
  CreateSandboxParams,
  StartSandboxFromSnapshotParams,
  SandboxRuntimeSession,
  SandboxRuntimeTarget,
  GetOrBuildSandboxImageOptions,
  ReuseSandboxDockerImageParams,
  SandboxDockerImageReuseResult,
  SandboxImageBuildResolution,
  SandboxImageBuildWaitOptions,
  SandboxImageSummary,
  Sandbox,
  SandboxDetail,
  SandboxExposeParams,
  SandboxExposeResult,
  SandboxExecParams,
  SandboxExecOptions,
  SandboxImageBuild,
  SandboxImageBuildCreateResult,
  SandboxImageBuildListParams,
  SandboxImageBuildListResponse,
  SandboxImageListParams,
  SandboxImageListResponse,
  SandboxListParams,
  SandboxListResponse,
  SandboxMemorySnapshotParams,
  SandboxMemorySnapshotResult,
  SandboxNetworkPolicyPatch,
  SandboxNetworkUpdateResult,
  SandboxProcessResult,
  SandboxImageDeleteResult,
  SandboxSnapshotDeleteResult,
  SandboxSnapshotListParams,
  SandboxSnapshotListResponse,
  SandboxSnapshotSummary,
  SandboxUnexposeResult,
} from "../types/sandbox";
import { retryDelay } from "../retry";
import { optionalInteger, optionalNumber } from "./normalize";
import { BaseService } from "./base";

const RUNTIME_SESSION_REFRESH_BUFFER_MS = 60_000;

type WireSandbox = Omit<Sandbox, "cpu" | "memoryMiB" | "diskMiB"> & {
  vcpus?: number | null;
  memMiB?: number | null;
  diskSizeMiB?: number | null;
};

type WireSandboxDetail = Omit<SandboxDetail, "cpu" | "memoryMiB" | "diskMiB"> & {
  vcpus?: number | null;
  memMiB?: number | null;
  diskSizeMiB?: number | null;
};

type WireSandboxListResponse = Omit<SandboxListResponse, "sandboxes"> & {
  sandboxes: WireSandbox[];
};

const normalizeSandbox = (sandbox: WireSandbox): Sandbox => {
  const { vcpus, memMiB, diskSizeMiB, ...rest } = sandbox;
  return {
    ...rest,
    cpu: optionalInteger(vcpus),
    memoryMiB: optionalInteger(memMiB),
    diskMiB: optionalInteger(diskSizeMiB),
    endTime: optionalInteger(rest.endTime),
    startTime: optionalInteger(rest.startTime),
    dataConsumed: optionalInteger(rest.dataConsumed),
    proxyDataConsumed: optionalInteger(rest.proxyDataConsumed),
    proxyBytesUsed: optionalInteger(rest.proxyBytesUsed),
    timeoutMinutes: optionalInteger(rest.timeoutMinutes),
    creditsUsed: optionalNumber(rest.creditsUsed) ?? null,
    exposedPorts: rest.exposedPorts ?? [],
    network: rest.network ? { ...rest.network, allowOut: rest.network.allowOut ?? [], denyOut: rest.network.denyOut ?? [] } : rest.network,
  };
};

const normalizeSandboxDetail = (detail: WireSandboxDetail): SandboxDetail => {
  const { token, tokenExpiresAt, ...sandbox } = detail;
  return {
    ...normalizeSandbox(sandbox),
    token: token || null,
    tokenExpiresAt: tokenExpiresAt || null,
  };
};

const normalizeSandboxListResponse = (response: WireSandboxListResponse): SandboxListResponse => ({
  ...response,
  sandboxes: response.sandboxes.map(normalizeSandbox),
});

const serializeCreateSandboxParams = (params: CreateSandboxParams): Record<string, unknown> => {
  if (!params || typeof params !== "object")
    throw new HyperbrowserError("Sandbox launch parameters are required");
  for (const name of ["imageName", "snapshotName", "imageId", "snapshotId"] as const) {
    const value = params[name];
    if (value !== undefined && (typeof value !== "string" || !value.trim()))
      throw new HyperbrowserError(`${name} must be a nonempty string`);
  }
  if (params.imageId !== undefined && !params.imageName)
    throw new HyperbrowserError("imageId requires imageName");
  if (params.snapshotId !== undefined && !params.snapshotName)
    throw new HyperbrowserError("snapshotId requires snapshotName");
  if (Boolean(params.imageName) === Boolean(params.snapshotName))
    throw new HyperbrowserError("Provide exactly one start source: snapshotName or imageName");
  for (const name of ["cpu", "memoryMiB", "diskMiB"] as const) {
    const value = params[name];
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1))
      throw new HyperbrowserError(`${name} must be a positive integer`);
  }
  if (
    params.runtimeClass !== undefined &&
    params.runtimeClass !== "firecracker" &&
    params.runtimeClass !== "gvisor-cpu"
  )
    throw new HyperbrowserError("Unsupported sandbox runtimeClass");
  if (typeof params.imageName === "string") {
    return {
      runtimeClass: params.runtimeClass,
      imageName: params.imageName,
      imageId: params.imageId,
      region: params.region,
      enableRecording: params.enableRecording,
      exposedPorts: params.exposedPorts,
      mounts: params.mounts,
      timeoutMinutes: params.timeoutMinutes,
      vcpus: params.cpu,
      memMiB: params.memoryMiB,
      diskSizeMiB: params.diskMiB,
      allowInternetAccess: params.allowInternetAccess,
      allowOut: params.allowOut,
      denyOut: params.denyOut,
    };
  }

  const snapshotParams = params as CreateSandboxParams & {
    cpu?: number;
    memoryMiB?: number;
    diskMiB?: number;
  };

  if (
    snapshotParams.cpu !== undefined ||
    snapshotParams.memoryMiB !== undefined ||
    snapshotParams.diskMiB !== undefined
  ) {
    throw new HyperbrowserError(
      "cpu, memoryMiB, and diskMiB are only supported for image launches",
      undefined
    );
  }

  return {
    runtimeClass: snapshotParams.runtimeClass,
    snapshotName: snapshotParams.snapshotName,
    snapshotId: snapshotParams.snapshotId,
    region: snapshotParams.region,
    enableRecording: snapshotParams.enableRecording,
    exposedPorts: snapshotParams.exposedPorts,
    mounts: snapshotParams.mounts,
    timeoutMinutes: snapshotParams.timeoutMinutes,
    allowInternetAccess: snapshotParams.allowInternetAccess,
    allowOut: snapshotParams.allowOut,
    denyOut: snapshotParams.denyOut,
  };
};

const IMAGE_BUILD_DEFAULT_POLL_INTERVAL_SECONDS = 3;
const IMAGE_BUILD_DEFAULT_WAIT_TIMEOUT_SECONDS = 35 * 60;
const IMAGE_BUILD_COMPLETE_RETRY_DELAY_MS = 2_000;
const READY_IMAGE_PAGE_SIZE = 100;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const serializeCreateImageBuildParams = (
  params: CreateSandboxImageBuildParams
): Record<string, unknown> => {
  for (const key of ["builderCpus", "builderMemoryMiB", "builderScratchMiB"] as const) {
    const value = params[key];
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) throw new HyperbrowserError(`${key} must be a positive integer`);
  }
  return ({
  imageName: params.imageName,
  inputSha256: params.inputSha256,
  inputSizeBytes: params.inputSizeBytes,
  vcpus: params.builderCpus,
  memMiB: params.builderMemoryMiB,
  scratchMiB: params.builderScratchMiB,
  inputFormat: params.inputFormat,
  sourcePlatform: params.sourcePlatform,
  imageConfigUser: params.imageConfigUser,
  imageInit: params.imageInit,
  dockerfilePath: params.dockerfilePath,
  contextManifest: params.contextManifest,
  dockerImageManifest: params.dockerImageManifest,
});
};

const normalizeImageBuildPlatform = (platform: string | undefined): string => {
  const normalized = (platform ?? IMAGE_BUILD_SOURCE_PLATFORM).trim().toLowerCase();
  if (normalized !== IMAGE_BUILD_SOURCE_PLATFORM) {
    throw new HyperbrowserError(`Image builds require platform '${IMAGE_BUILD_SOURCE_PLATFORM}'`);
  }
  return normalized;
};

type SandboxRuntimeState = SandboxRuntimeSession;

const resolveSandboxRuntimeSessionHost = (
  runtime: SandboxDetail["runtime"],
  baseUrl: URL
): string => {
  const sessionIdFromBasePath = runtimeSessionIdFromPath(baseUrl.pathname);
  if (sessionIdFromBasePath && baseUrl.hostname) {
    return `${sessionIdFromBasePath}.${baseUrl.hostname}`;
  }

  const runtimeHost = runtime.host?.trim() || "";
  if (runtimeHost) {
    try {
      const parsedHost = new URL(runtimeHost);
      const sessionIdFromHostPath = runtimeSessionIdFromPath(parsedHost.pathname);
      if (sessionIdFromHostPath && parsedHost.hostname) {
        return `${sessionIdFromHostPath}.${parsedHost.hostname}`;
      }
      if (parsedHost.hostname) {
        return parsedHost.hostname;
      }
    } catch {
      return runtimeHost;
    }
  }

  return baseUrl.hostname;
};

const buildSandboxExposedUrl = (runtime: SandboxDetail["runtime"], port: number): string => {
  const baseUrl = new URL(runtime.baseUrl);
  const sessionHost = resolveSandboxRuntimeSessionHost(runtime, baseUrl);
  const authority = baseUrl.port
    ? `${port}-${sessionHost}:${baseUrl.port}`
    : `${port}-${sessionHost}`;
  return new URL("/", `${baseUrl.protocol}//${authority}`).toString();
};

const upsertExposedPort = (
  exposedPorts: SandboxExposeResult[],
  updated: SandboxExposeResult
): SandboxExposeResult[] =>
  [...exposedPorts.filter((entry) => entry.port !== updated.port), updated].sort(
    (left, right) => left.port - right.port
  );

export class SandboxHandle {
  public readonly processes: SandboxProcessesApi;
  public readonly files: SandboxFilesApi;
  public readonly terminal: SandboxTerminalApi;
  public readonly pty: SandboxTerminalApi;
  private readonly transport: RuntimeTransport;
  private detail: SandboxDetail;
  private runtimeSession: SandboxRuntimeState | null;

  constructor(
    private readonly service: SandboxesService,
    detail: SandboxDetail
  ) {
    this.detail = detail;
    this.runtimeSession = SandboxHandle.toRuntimeSession(detail);
    this.transport = new RuntimeTransport(
      (forceRefresh) => this.resolveRuntimeConnection(forceRefresh),
      service.runtimeTimeout,
      service.runtimeProxyOverride
    );
    this.processes = new SandboxProcessesApi(this.transport);
    this.files = new SandboxFilesApi(
      this.transport,
      () => this.resolveRuntimeSocketConnectionInfo(),
      service.runtimeProxyOverride
    );
    this.terminal = new SandboxTerminalApi(
      this.transport,
      () => this.resolveRuntimeSocketConnectionInfo(),
      service.runtimeProxyOverride
    );
    this.pty = this.terminal;
  }

  get id(): string {
    return this.detail.id;
  }

  get status(): SandboxDetail["status"] {
    return this.detail.status;
  }

  get region(): SandboxDetail["region"] {
    return this.detail.region;
  }

  get runtime(): SandboxDetail["runtime"] {
    return this.detail.runtime;
  }

  get tokenExpiresAt(): string | null {
    return this.detail.tokenExpiresAt;
  }

  get sessionUrl(): string {
    return this.detail.sessionUrl;
  }

  get cpu(): number | null | undefined {
    return this.detail.cpu;
  }

  get memoryMiB(): number | null | undefined {
    return this.detail.memoryMiB;
  }

  get diskMiB(): number | null | undefined {
    return this.detail.diskMiB;
  }

  get timeoutMinutes(): number | null | undefined {
    return this.detail.timeoutMinutes;
  }

  get exposedPorts(): SandboxExposeResult[] {
    return (this.detail.exposedPorts ?? []).map((entry) => ({ ...entry }));
  }

  toJSON(): SandboxDetail {
    return { ...this.detail };
  }

  async info(): Promise<SandboxDetail> {
    const detail = await this.service.getDetail(this.id);
    this.hydrate(detail);
    return this.toJSON();
  }

  async refresh(): Promise<SandboxHandle> {
    await this.info();
    return this;
  }

  async connect(): Promise<SandboxHandle> {
    await this.ensureRuntimeSession(true);
    return this;
  }

  async stop(): Promise<BasicResponse> {
    const response = await this.service.stop(this.id);
    this.clearRuntimeSession("closed");
    return response;
  }

  async createMemorySnapshot(
    params: SandboxMemorySnapshotParams = {}
  ): Promise<SandboxMemorySnapshotResult> {
    return this.service.createMemorySnapshot(this.id, params);
  }

  async expose(params: SandboxExposeParams): Promise<SandboxExposeResult> {
    const exposure = await this.service.expose(this.id, params, this.runtime);
    this.detail = {
      ...this.detail,
      exposedPorts: upsertExposedPort(this.detail.exposedPorts ?? [], exposure),
    };
    return exposure;
  }

  async unexpose(port: number): Promise<SandboxUnexposeResult> {
    const response = await this.service.unexpose(this.id, port);
    this.detail = {
      ...this.detail,
      exposedPorts: (this.detail.exposedPorts ?? []).filter((entry) => entry.port !== port),
    };
    return response;
  }

  getExposedUrl(port: number): string {
    return buildSandboxExposedUrl(this.runtime, port);
  }

  get network(): SandboxDetail["network"] {
    return this.detail.network;
  }

  async updateNetwork(policy: SandboxNetworkPolicyPatch): Promise<SandboxNetworkUpdateResult> {
    const result = await this.service.updateNetwork(this.id, policy);
    this.detail = {
      ...this.detail,
      network: result.network,
    };
    return result;
  }

  async clearNetwork(): Promise<SandboxNetworkUpdateResult> {
    return this.updateNetwork({
      allowInternetAccess: true,
      allowOut: [],
      denyOut: [],
    });
  }

  async exec(input: string, options?: SandboxExecOptions): Promise<SandboxProcessResult>;
  async exec(input: SandboxExecParams): Promise<SandboxProcessResult>;
  async exec(
    input: string | SandboxExecParams,
    options?: SandboxExecOptions
  ): Promise<SandboxProcessResult> {
    if (typeof input === "string") {
      return this.processes.exec(input, options);
    }

    return this.processes.exec(input);
  }

  async getProcess(processId: string): Promise<SandboxProcessHandle> {
    return this.processes.get(processId);
  }

  private hydrate(detail: SandboxDetail) {
    this.detail = detail;
    this.runtimeSession = SandboxHandle.toRuntimeSession(detail);
  }

  private async resolveRuntimeConnection(
    forceRefresh: boolean = false
  ): Promise<RuntimeConnection> {
    const session = await this.ensureRuntimeSession(forceRefresh);
    return {
      sandboxId: this.id,
      baseUrl: session.runtime.baseUrl,
      token: session.token,
    };
  }

  private async resolveRuntimeSocketConnectionInfo(): Promise<{
    sandboxId: string;
    baseUrl: string;
    token: string;
  }> {
    const session = await this.ensureRuntimeSession();
    return {
      sandboxId: this.id,
      baseUrl: session.runtime.baseUrl,
      token: session.token,
    };
  }

  private isRuntimeSessionExpiring(): boolean {
    if (!this.runtimeSession?.tokenExpiresAt) {
      return false;
    }

    const expiresAt = Date.parse(this.runtimeSession.tokenExpiresAt);
    if (Number.isNaN(expiresAt)) {
      return false;
    }

    return expiresAt - Date.now() <= RUNTIME_SESSION_REFRESH_BUFFER_MS;
  }

  async createRuntimeSession(
    options: { forceRefresh?: boolean } = {}
  ): Promise<SandboxRuntimeSession> {
    const session = await this.ensureRuntimeSession(options.forceRefresh);
    return { ...session, runtime: { ...session.runtime } };
  }

  private async ensureRuntimeSession(forceRefresh: boolean = false): Promise<SandboxRuntimeState> {
    this.assertRuntimeAvailable();

    if (!forceRefresh && this.runtimeSession && !this.isRuntimeSessionExpiring()) {
      return { ...this.runtimeSession };
    }

    const detail = await this.service.getDetail(this.id);
    this.hydrate(detail);

    if (!this.runtimeSession) {
      throw new HyperbrowserError(`Sandbox ${this.id} is not running`, {
        statusCode: 409,
        code: "sandbox_not_running",
        retryable: false,
        service: "runtime",
      });
    }

    return { ...this.runtimeSession };
  }

  private applyRuntimeSession(session: SandboxRuntimeState) {
    this.runtimeSession = { ...session };
    this.detail = {
      ...this.detail,
      status: session.status,
      region: session.region,
      runtime: session.runtime,
      token: session.token,
      tokenExpiresAt: session.tokenExpiresAt,
    };
  }

  private clearRuntimeSession(status: SandboxDetail["status"] = this.detail.status) {
    this.runtimeSession = null;
    this.detail = {
      ...this.detail,
      status,
      token: null,
      tokenExpiresAt: null,
    };
  }

  private assertRuntimeAvailable() {
    if (
      this.detail.status === "closed" ||
      this.detail.status === "close-error" ||
      this.detail.status === "error"
    ) {
      throw new HyperbrowserError(`Sandbox ${this.id} is not running`, {
        statusCode: 409,
        code: "sandbox_not_running",
        retryable: false,
        service: "runtime",
      });
    }
  }

  private static toRuntimeSession(detail: SandboxDetail): SandboxRuntimeState | null {
    if (!detail.token) {
      return null;
    }

    return {
      sandboxId: detail.id,
      status: detail.status,
      region: detail.region,
      token: detail.token,
      tokenExpiresAt: detail.tokenExpiresAt,
      runtime: detail.runtime,
    };
  }
}

export class SandboxesService extends BaseService {
  public readonly runtimeTimeout: number;
  public readonly runtimeProxyOverride?: string;

  constructor(apiKey: string, baseUrl: string, timeout: number, runtimeProxyOverride?: string) {
    super(apiKey, baseUrl, timeout);
    this.runtimeTimeout = timeout;
    this.runtimeProxyOverride = runtimeProxyOverride;
  }

  async create(params: CreateSandboxParams): Promise<SandboxHandle> {
    const detail = await this.createDetail(params);
    return this.attach(detail);
  }

  async startFromSnapshot(params: StartSandboxFromSnapshotParams): Promise<SandboxHandle> {
    if (!params?.snapshotName) throw new HyperbrowserError("snapshotName is required");
    return this.create(params);
  }

  async getRuntimeSession(id: string): Promise<SandboxRuntimeSession> {
    const detail = await this.getDetail(id);
    if (!detail.token || ["closed", "close-error", "error"].includes(detail.status)) {
      throw new HyperbrowserError(`Sandbox ${id} is not running`, {
        statusCode: 409,
        code: "sandbox_not_running",
        service: "runtime",
      });
    }
    return {
      sandboxId: id,
      status: detail.status,
      region: detail.region,
      token: detail.token,
      tokenExpiresAt: detail.tokenExpiresAt,
      runtime: { ...detail.runtime },
    };
  }

  async get(id: string): Promise<SandboxHandle> {
    const detail = await this.getDetail(id);
    return this.attach(detail);
  }

  async connect(id: string): Promise<SandboxHandle> {
    const handle = await this.get(id);
    await handle.connect();
    return handle;
  }

  async list(params: SandboxListParams = {}): Promise<SandboxListResponse> {
    try {
      const response = await this.request<WireSandboxListResponse>("/sandboxes", undefined, {
        status: params.status,
        start: params.start,
        end: params.end,
        search: params.search,
        page: params.page,
        limit: params.limit,
      });
      return normalizeSandboxListResponse(response);
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError("Failed to list sandboxes", undefined);
    }
  }

  async deleteImage(image: string): Promise<SandboxImageDeleteResult> {
    try {
      return await this.request<SandboxImageDeleteResult>(`/images/${encodeURIComponent(image)}`, {
        method: "DELETE",
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to delete image ${image}`);
    }
  }

  async listImages(params: SandboxImageListParams = {}): Promise<SandboxImageListResponse> {
    try {
      return await this.request<SandboxImageListResponse>("/images", undefined, {
        source: params.source,
        search: params.search,
        page: params.page,
        limit: params.limit,
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError("Failed to list sandbox images", undefined);
    }
  }

  async listSnapshots(
    params: SandboxSnapshotListParams = {}
  ): Promise<SandboxSnapshotListResponse> {
    try {
      return await this.request<SandboxSnapshotListResponse>("/snapshots", undefined, {
        status: params.status,
        imageName: params.imageName,
        search: params.search,
        page: params.page,
        limit: params.limit,
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError("Failed to list sandbox snapshots", undefined);
    }
  }

  async stop(id: string): Promise<BasicResponse> {
    try {
      return await this.request<BasicResponse>(`/sandbox/${id}/stop`, {
        method: "PUT",
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to stop sandbox ${id}`, undefined);
    }
  }

  async getDetail(id: string): Promise<SandboxDetail> {
    try {
      const detail = await this.request<WireSandboxDetail>(`/sandbox/${id}`);
      return normalizeSandboxDetail(detail);
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to get sandbox ${id}`, undefined);
    }
  }

  attach(detail: SandboxDetail): SandboxHandle {
    return new SandboxHandle(this, detail);
  }

  async createMemorySnapshot(
    id: string,
    params: SandboxMemorySnapshotParams = {}
  ): Promise<SandboxMemorySnapshotResult> {
    try {
      return await this.request<SandboxMemorySnapshotResult>(`/sandbox/${id}/snapshot`, {
        method: "POST",
        body: JSON.stringify(params),
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to create memory snapshot for sandbox ${id}`, undefined);
    }
  }

  async expose(
    id: string,
    params: SandboxExposeParams,
    runtime?: SandboxRuntimeTarget
  ): Promise<SandboxExposeResult> {
    try {
      const exposure = await this.request<SandboxExposeResult>(`/sandbox/${id}/expose`, {
        method: "POST",
        body: JSON.stringify(params),
      });
      if (!exposure.url)
        exposure.url = buildSandboxExposedUrl(
          runtime ?? (await this.getDetail(id)).runtime,
          exposure.port
        );
      return exposure;
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to expose port ${params.port} for sandbox ${id}`);
    }
  }

  async getSnapshot(snapshot: string): Promise<SandboxSnapshotSummary> {
    try {
      const response = await this.request<{ snapshot: SandboxSnapshotSummary }>(
        `/snapshots/${encodeURIComponent(snapshot)}`
      );
      return response.snapshot;
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to get snapshot ${snapshot}`);
    }
  }

  async deleteSnapshot(snapshot: string): Promise<SandboxSnapshotDeleteResult> {
    try {
      return await this.request<SandboxSnapshotDeleteResult>(
        `/snapshots/${encodeURIComponent(snapshot)}`,
        { method: "DELETE" }
      );
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to delete snapshot ${snapshot}`);
    }
  }

  async createImageBuild(
    params: CreateSandboxImageBuildParams
  ): Promise<SandboxImageBuildCreateResult> {
    try {
      return await this.request<SandboxImageBuildCreateResult>("/images/builds", {
        method: "POST",
        body: JSON.stringify(serializeCreateImageBuildParams(params)),
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError("Failed to create image build");
    }
  }

  async getImageBuild(
    buildId: string,
    options: { signal?: AbortSignal } = {}
  ): Promise<SandboxImageBuild> {
    try {
      const response = await this.request<{ build: SandboxImageBuild }>(
        `/images/builds/${encodeURIComponent(buildId)}`,
        { signal: options.signal }
      );
      return response.build;
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to get image build ${buildId}`);
    }
  }

  async listImageBuilds(
    params: SandboxImageBuildListParams = {}
  ): Promise<SandboxImageBuildListResponse> {
    try {
      return await this.request<SandboxImageBuildListResponse>("/images/builds", undefined, {
        status: params.status,
        limit: params.limit,
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError("Failed to list image builds");
    }
  }

  async completeImageBuild(
    buildId: string,
    params: CompleteSandboxImageBuildParams
  ): Promise<SandboxImageBuild> {
    try {
      const response = await this.request<{ build: SandboxImageBuild }>(
        `/images/builds/${encodeURIComponent(buildId)}/complete`,
        {
          method: "POST",
          body: JSON.stringify(params),
        }
      );
      return response.build;
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to complete image build ${buildId}`);
    }
  }

  async cancelImageBuild(buildId: string): Promise<SandboxImageBuild> {
    try {
      const response = await this.request<{ build: SandboxImageBuild }>(
        `/images/builds/${encodeURIComponent(buildId)}/cancel`,
        { method: "POST" }
      );
      return response.build;
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to cancel image build ${buildId}`);
    }
  }

  async reuseDockerImage(
    params: ReuseSandboxDockerImageParams
  ): Promise<SandboxDockerImageReuseResult> {
    try {
      return await this.request<SandboxDockerImageReuseResult>("/images/builds/reuse", {
        method: "POST",
        body: JSON.stringify(params),
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError("Failed to reuse Docker image");
    }
  }

  /** Find an exact ready team image, including revisions awaiting backup. */
  async findReadyImage(imageName: string): Promise<SandboxImageSummary | null> {
    let page = 1;
    for (;;) {
      const response = await this.listImages({
        search: imageName,
        source: ["team"],
        page,
        limit: READY_IMAGE_PAGE_SIZE,
      });
      for (const image of response.images) {
        if (image.imageName === imageName && (image.uploaded || image.ready === true)) {
          return image;
        }
      }
      if (response.images.length < READY_IMAGE_PAGE_SIZE) {
        return null;
      }
      if (
        typeof response.totalCount === "number" &&
        page * READY_IMAGE_PAGE_SIZE >= response.totalCount
      ) {
        return null;
      }
      page += 1;
    }
  }

  /** Poll an image build until it completes, rejecting on failure or timeout. */
  async waitForImageBuild(
    buildId: string,
    options: SandboxImageBuildWaitOptions = {}
  ): Promise<SandboxImageBuild> {
    const pollInterval = options.pollInterval ?? IMAGE_BUILD_DEFAULT_POLL_INTERVAL_SECONDS;
    const timeout =
      options.timeout === undefined ? IMAGE_BUILD_DEFAULT_WAIT_TIMEOUT_SECONDS : options.timeout;
    if (
      !Number.isFinite(pollInterval) ||
      pollInterval < 0 ||
      (timeout !== null && (!Number.isFinite(timeout) || timeout < 0))
    ) {
      throw new HyperbrowserError(
        "Image build wait timeout and interval must be nonnegative finite seconds"
      );
    }
    const controller = new AbortController();
    let timedOut = false;
    const deadlineTimer =
      timeout === null
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, timeout * 1000);
    const cancel = () => controller.abort();
    options.signal?.addEventListener("abort", cancel, { once: true });
    if (options.signal?.aborted) cancel();
    const waitFailure = (error: unknown): never => {
      if (timedOut)
        throw new HyperbrowserError(`Timed out waiting for image build ${buildId}`, {
          code: "wait_timeout",
          service: "control",
          cause: error,
        });
      throw error;
    };
    try {
      for (;;) {
        const build = await this.getImageBuild(buildId, { signal: controller.signal }).catch(waitFailure);
        if (build.status === "completed") return build;
        if (build.status === "failed" || build.status === "canceled") {
          throw new HyperbrowserError(
            build.errorMessage || `Image build ${buildId} ${build.status}`,
            { code: build.errorCode || "image_build_failed", service: "control", details: build }
          );
        }
        await retryDelay(pollInterval * 1000, controller.signal).catch(waitFailure);
      }
    } finally {
      clearTimeout(deadlineTimer);
      options.signal?.removeEventListener("abort", cancel);
    }
  }

  /** Import a local Docker image as reusable layers, reusing exact cached imports. */
  async buildImageFromDockerImage(
    options: BuildSandboxImageFromDockerImageOptions
  ): Promise<SandboxImageBuild> {
    const platform = normalizeImageBuildPlatform(options.platform);
    const source = await prepareDockerImageManifestSource(options.dockerImage, { platform });
    try {
      if (
        options.expectedImageDigest !== undefined &&
        source.imageDigest !== options.expectedImageDigest.toLowerCase()
      ) {
        throw new HyperbrowserError(
          "Docker image changed after its cache identity was computed. " +
            "Retry with a fresh image digest."
        );
      }
      const imageInit = mergeImageInit(source.imageInit, options.imageInit);
      const imageConfigUser = options.imageConfigUser ?? source.imageConfigUser;
      let reused: SandboxDockerImageReuseResult | null = null;
      try {
        reused = await this.reuseDockerImage({
          imageName: options.imageName,
          sourceImageDigest: source.imageDigest,
          sourcePlatform: "linux/amd64",
          imageConfigUser,
          imageInit,
        });
      } catch (error) {
        if (!(error instanceof HyperbrowserError) || error.statusCode !== 404) {
          throw error;
        }
      }
      if (reused?.hit) {
        if (!reused.build) {
          throw new HyperbrowserError("exact image cache response is missing its completed build");
        }
        return reused.build;
      }

      const packaged = await packageDockerImageManifest(
        options.dockerImage,
        source.imageDigest,
        source.config,
        { platform, tempDir: options.tempDir }
      );
      try {
        return await this.submitImageBuild(
          {
            imageName: options.imageName,
            inputSha256: packaged.artifact.sha256Hex,
            inputSizeBytes: packaged.artifact.sizeBytes,
            inputFormat: packaged.artifact.inputFormat,
            sourcePlatform: "linux/amd64",
            imageConfigUser,
            imageInit,
            dockerImageManifest: packaged.manifest,
            builderCpus: options.builderCpus,
            builderMemoryMiB: options.builderMemoryMiB,
            builderScratchMiB: options.builderScratchMiB,
          },
          packaged.artifact,
          packaged.layers,
          "Docker image layer",
          options
        );
      } finally {
        packaged.cleanup();
      }
    } finally {
      await source.cleanup();
    }
  }

  /**
   * Build a Dockerfile into a sandbox image.
   *
   * Remote builds (default) upload only the effective build context and build
   * on Hyperbrowser. `remote: false` builds with local Docker and imports the
   * resulting image instead.
   */
  async buildImageFromDockerfile(
    options: BuildSandboxImageFromDockerfileOptions
  ): Promise<SandboxImageBuild> {
    options = { ...options, platform: normalizeImageBuildPlatform(options.platform) };
    const remote = options.remote ?? true;
    if (remote) {
      if (
        options.dockerTag !== undefined ||
        (options.buildArgs && Object.keys(options.buildArgs).length > 0)
      ) {
        throw new HyperbrowserError(
          "dockerTag and buildArgs require remote: false; remote Dockerfile builds " +
            "send the build context to Hyperbrowser"
        );
      }
      return this.buildImageFromRemoteDockerfile(options);
    }
    if (options.expectedContextFingerprint !== undefined) {
      throw new HyperbrowserError("expectedContextFingerprint requires remote: true");
    }
    const tag = options.dockerTag ?? makeTempDockerTag();
    try {
      await buildDockerImageFromDockerfile({
        contextPath: options.contextPath,
        dockerfile: options.dockerfile,
        tag,
        platform: options.platform,
        buildArgs: options.buildArgs,
      });
      return await this.buildImageFromDockerImage({
        dockerImage: tag,
        imageName: options.imageName,
        platform: options.platform,
        imageInit: options.imageInit,
        imageConfigUser: options.imageConfigUser,
        builderCpus: options.builderCpus,
        builderMemoryMiB: options.builderMemoryMiB,
        builderScratchMiB: options.builderScratchMiB,
        wait: options.wait,
        pollInterval: options.pollInterval,
        waitTimeout: options.waitTimeout,
        signal: options.signal,
        tempDir: options.tempDir,
        uploadTimeout: options.uploadTimeout,
      });
    } finally {
      if (options.dockerTag === undefined) {
        await removeDockerImage(tag);
      }
    }
  }

  /**
   * Reuse, join, or build content-derived remote Dockerfile/image inputs.
   *
   * Supply exactly one of `contextPath` or `dockerImage`. Names include source
   * contents, platform and image initialization overrides. `forceBuild` skips
   * ready-image lookup, but joins matching active builds and retains builder
   * layer/artifact caches. Canceling polling never cancels the backend build.
   * `waitTimeout` applies to this caller's polling, independently of uploads.
   * This composes existing APIs; lookup plus creation is not server-atomic.
   */
  async getOrBuildImage(
    options: GetOrBuildSandboxImageOptions
  ): Promise<SandboxImageBuildResolution> {
    const platform = normalizeImageBuildPlatform(options.platform);
    const dockerfile = options.dockerfile ?? "Dockerfile";
    const remoteFullContext = options.remoteFullContext ?? false;
    const { contextPath, dockerImage } = options;
    if ((contextPath === undefined) === (dockerImage === undefined)) {
      throw new HyperbrowserError("Supply exactly one of contextPath or dockerImage");
    }
    let fingerprint: string;
    let source: "dockerfile" | "prebuilt";
    let inputFormat: string;
    if (contextPath !== undefined) {
      if (options.expectedImageDigest !== undefined) {
        throw new HyperbrowserError("expectedImageDigest requires dockerImage");
      }
      fingerprint =
        options.expectedContextFingerprint ??
        (await dockerBuildContextFingerprint(contextPath, {
          dockerfile,
          forceFullContext: remoteFullContext,
        }));
      source = "dockerfile";
      inputFormat = "dockerfile_context_manifest_v1";
    } else {
      if (
        options.expectedContextFingerprint !== undefined ||
        remoteFullContext ||
        dockerfile !== "Dockerfile"
      ) {
        throw new HyperbrowserError("Dockerfile context options require contextPath");
      }
      fingerprint =
        options.expectedImageDigest ??
        (await dockerImageDigest(dockerImage as string, { platform }));
      source = "prebuilt";
      inputFormat = "docker_image_manifest_v1";
    }
    const imageName = imageBuildName({
      source,
      fingerprint,
      namePrefix: options.imageNamePrefix,
      platform,
      imageInit: options.imageInit,
      imageConfigUser: options.imageConfigUser,
    });
    if (!options.forceBuild) {
      const image = await this.findReadyImage(imageName);
      if (image !== null) {
        return { outcome: "reused", imageName, imageId: image.id };
      }
    }
    const common = {
      imageName,
      platform,
      imageInit: options.imageInit,
      imageConfigUser: options.imageConfigUser,
      builderCpus: options.builderCpus,
      builderMemoryMiB: options.builderMemoryMiB,
      builderScratchMiB: options.builderScratchMiB,
      wait: false,
      uploadTimeout: options.uploadTimeout === undefined ? 600 : options.uploadTimeout,
      tempDir: options.tempDir,
    };
    let outcome: SandboxImageBuildResolution["outcome"] = "created";
    let build: SandboxImageBuild;
    try {
      build =
        contextPath !== undefined
          ? await this.buildImageFromDockerfile({
              ...common,
              contextPath,
              dockerfile,
              remote: true,
              remoteFullContext,
              expectedContextFingerprint: fingerprint,
            })
          : await this.buildImageFromDockerImage({
              ...common,
              dockerImage: dockerImage as string,
              expectedImageDigest: fingerprint,
            });
    } catch (error) {
      if (!(error instanceof HyperbrowserError)) {
        throw error;
      }
      const existing = matchingImageBuild(error, imageName, inputFormat);
      if (existing === null) {
        throw error;
      }
      build = existing;
      outcome = "joined";
    }
    const wait = options.wait ?? true;
    if (wait && build.status !== "completed") {
      build = await this.waitForImageBuild(build.id, {
        pollInterval: options.pollInterval,
        timeout: options.waitTimeout,
        signal: options.signal,
      });
    }
    return { outcome, imageName, imageId: completedImageId(build), build };
  }

  private async buildImageFromRemoteDockerfile(
    options: BuildSandboxImageFromDockerfileOptions
  ): Promise<SandboxImageBuild> {
    const packaged = await packageDockerBuildContextManifest(options.contextPath, {
      dockerfile: options.dockerfile,
      forceFullContext: options.remoteFullContext,
      expectedContextFingerprint: options.expectedContextFingerprint,
      tempDir: options.tempDir,
    });
    try {
      return await this.submitImageBuild(
        {
          imageName: options.imageName,
          inputSha256: packaged.artifact.sha256Hex,
          inputSizeBytes: packaged.artifact.sizeBytes,
          inputFormat: packaged.artifact.inputFormat,
          sourcePlatform: "linux/amd64",
          dockerfilePath: packaged.manifest.dockerfilePath,
          imageConfigUser: options.imageConfigUser,
          imageInit: options.imageInit,
          contextManifest: packaged.manifest,
          builderCpus: options.builderCpus,
          builderMemoryMiB: options.builderMemoryMiB,
          builderScratchMiB: options.builderScratchMiB,
        },
        packaged.artifact,
        packaged.bundles,
        "build context bundle",
        options
      );
    } finally {
      packaged.cleanup();
    }
  }

  /** Create a build, upload requested artifacts, complete it, and optionally wait. */
  private async submitImageBuild(
    params: CreateSandboxImageBuildParams,
    artifact: DockerImageBuildArtifact,
    artifacts: Record<string, DockerImageBuildArtifact>,
    label: string,
    options: {
      wait?: boolean;
      pollInterval?: number;
      waitTimeout?: number | null;
      signal?: AbortSignal;
      uploadTimeout?: number | null;
    }
  ): Promise<SandboxImageBuild> {
    let buildId: string | null = null;
    let buildStarted = false;
    try {
      const createResult = await this.createImageBuild(params);
      buildId = createResult.build.id;
      await uploadMissingImageBuildArtifacts(createResult.uploads, artifacts, {
        label,
        timeout: options.uploadTimeout,
      });
      const build = await this.completeImageBuildResilient(buildId, artifact);
      buildStarted = true;
      if (options.wait ?? true) {
        return await this.waitForImageBuild(build.id, {
          pollInterval: options.pollInterval,
          timeout: options.waitTimeout,
          signal: options.signal,
        });
      }
      return build;
    } catch (error) {
      if (buildId !== null && !buildStarted) {
        try {
          await this.cancelImageBuild(buildId);
        } catch {
          // Best-effort cancellation; surface the original error.
        }
      }
      throw error;
    }
  }

  private async completeImageBuildResilient(
    buildId: string,
    artifact: DockerImageBuildArtifact
  ): Promise<SandboxImageBuild> {
    const params: CompleteSandboxImageBuildParams = {
      inputSha256: artifact.sha256Hex,
      inputSizeBytes: artifact.sizeBytes,
      inputFormat: artifact.inputFormat,
    };
    try {
      return await this.completeImageBuild(buildId, params);
    } catch (error) {
      if (!(error instanceof HyperbrowserError) || error.statusCode !== 409) {
        throw error;
      }
      if (error.message.toLowerCase().includes("already in progress")) {
        return this.getImageBuild(buildId);
      }
      const current = await this.getImageBuild(buildId);
      if (current.status !== "awaiting_upload" && current.status !== "upload_verified") {
        throw error;
      }
      await sleep(IMAGE_BUILD_COMPLETE_RETRY_DELAY_MS);
      return this.completeImageBuild(buildId, params);
    }
  }

  async updateNetwork(
    id: string,
    policy: SandboxNetworkPolicyPatch
  ): Promise<SandboxNetworkUpdateResult> {
    try {
      return await this.request<SandboxNetworkUpdateResult>(`/sandbox/${id}/network`, {
        method: "PUT",
        body: JSON.stringify(policy),
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to update network policy for sandbox ${id}`);
    }
  }

  async unexpose(id: string, port: number): Promise<SandboxUnexposeResult> {
    try {
      return await this.request<SandboxUnexposeResult>(`/sandbox/${id}/unexpose`, {
        method: "POST",
        body: JSON.stringify({ port }),
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to unexpose port ${port} for sandbox ${id}`);
    }
  }

  private async createDetail(params: CreateSandboxParams): Promise<SandboxDetail> {
    try {
      const detail = await this.request<WireSandboxDetail>("/sandbox", {
        method: "POST",
        body: JSON.stringify(serializeCreateSandboxParams(params)),
      });
      return normalizeSandboxDetail(detail);
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError("Failed to create sandbox", undefined);
    }
  }
}
