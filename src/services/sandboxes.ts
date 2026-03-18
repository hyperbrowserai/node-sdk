import { HyperbrowserError } from "../client";
import { SandboxFilesApi } from "../sandbox/files";
import { RuntimeConnection, RuntimeTransport } from "../sandbox/base";
import { SandboxProcessHandle, SandboxProcessesApi } from "../sandbox/process";
import { SandboxTerminalApi } from "../sandbox/terminal";
import { BasicResponse } from "../types/session";
import {
  CreateSandboxParams,
  SandboxDetail,
  SandboxExposeParams,
  SandboxExposeResult,
  SandboxExecParams,
  SandboxImageListResponse,
  SandboxListParams,
  SandboxListResponse,
  SandboxMemorySnapshotParams,
  SandboxMemorySnapshotResult,
  SandboxProcessResult,
  SandboxRuntimeTarget,
  SandboxSnapshotListParams,
  SandboxSnapshotListResponse,
} from "../types/sandbox";
import { BaseService } from "./base";

const RUNTIME_SESSION_REFRESH_BUFFER_MS = 60_000;

type SandboxRuntimeState = {
  sandboxId: string;
  status: SandboxDetail["status"];
  region: SandboxDetail["region"];
  token: string;
  tokenExpiresAt: string | null;
  runtime: SandboxDetail["runtime"];
};

const buildSandboxExposedUrl = (runtime: SandboxRuntimeTarget, port: number): string => {
  const url = new URL(runtime.baseUrl);
  url.hostname = `${port}-${url.hostname}`;
  return url.toString().replace(/\/$/, "");
};

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
    return this.service.expose(this.id, params, this.runtime);
  }

  getExposedUrl(port: number): string {
    return buildSandboxExposedUrl(this.runtime, port);
  }

  async exec(input: string | SandboxExecParams): Promise<SandboxProcessResult> {
    const params =
      typeof input === "string"
        ? {
            command: input,
          }
        : input;

    return this.processes.exec(params);
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
    if (this.detail.status === "closed" || this.detail.status === "error") {
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
      return await this.request<SandboxListResponse>("/sandboxes", undefined, {
        status: params.status,
        page: params.page,
        limit: params.limit,
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError("Failed to list sandboxes", undefined);
    }
  }

  async listImages(): Promise<SandboxImageListResponse> {
    try {
      return await this.request<SandboxImageListResponse>("/images");
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
      return await this.request<SandboxDetail>(`/sandbox/${id}`);
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
      const response = await this.request<{
        port: number;
        auth: boolean;
      }>(`/sandbox/${id}/expose`, {
        method: "POST",
        body: JSON.stringify(params),
      });

      const targetRuntime = runtime ?? (await this.getDetail(id)).runtime;
      return {
        port: response.port,
        auth: response.auth,
        url: buildSandboxExposedUrl(targetRuntime, response.port),
      };
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to expose port ${params.port} for sandbox ${id}`);
    }
  }

  private async createDetail(params: CreateSandboxParams): Promise<SandboxDetail> {
    try {
      return await this.request<SandboxDetail>("/sandbox", {
        method: "POST",
        body: JSON.stringify(params),
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError("Failed to create sandbox", undefined);
    }
  }
}
