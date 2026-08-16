import { HyperbrowserError } from "../client";
import { SandboxFilesApi } from "../sandbox/files";
import { RuntimeConnection, RuntimeTransport } from "../sandbox/base";
import { runtimeSessionIdFromPath } from "../sandbox/runtime-path";
import { SandboxProcessHandle, SandboxProcessesApi } from "../sandbox/process";
import { SandboxTerminalApi } from "../sandbox/terminal";
import { BasicResponse } from "../types/session";
import {
  CompleteSandboxImageBuildParams,
  CreateSandboxImageBuildParams,
  CreateSandboxParams,
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
    cpu: vcpus,
    memoryMiB: memMiB,
    diskMiB: diskSizeMiB,
  };
};

const normalizeSandboxDetail = (detail: WireSandboxDetail): SandboxDetail => {
  const { token, tokenExpiresAt, ...sandbox } = detail;
  return {
    ...normalizeSandbox(sandbox),
    token,
    tokenExpiresAt,
  };
};

const normalizeSandboxListResponse = (response: WireSandboxListResponse): SandboxListResponse => ({
  ...response,
  sandboxes: response.sandboxes.map(normalizeSandbox),
});

const serializeCreateSandboxParams = (params: CreateSandboxParams): Record<string, unknown> => {
  if (typeof params.imageName === "string") {
    return {
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

type SandboxRuntimeState = {
  sandboxId: string;
  status: SandboxDetail["status"];
  region: SandboxDetail["region"];
  token: string;
  tokenExpiresAt: string | null;
  runtime: SandboxDetail["runtime"];
};

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
    const exposure = await this.service.expose(this.id, params);
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

  async expose(id: string, params: SandboxExposeParams): Promise<SandboxExposeResult> {
    try {
      return await this.request<SandboxExposeResult>(`/sandbox/${id}/expose`, {
        method: "POST",
        body: JSON.stringify(params),
      });
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
        body: JSON.stringify(params),
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError("Failed to create image build");
    }
  }

  async getImageBuild(buildId: string): Promise<SandboxImageBuild> {
    try {
      const response = await this.request<{ build: SandboxImageBuild }>(
        `/images/builds/${encodeURIComponent(buildId)}`
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
