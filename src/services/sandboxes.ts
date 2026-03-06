import { HyperbrowserError } from "../client";
import { SandboxFilesApi } from "../runtime/files";
import { RuntimeConnection, RuntimeTransport } from "../runtime/base";
import { SandboxProcessHandle, SandboxProcessesApi } from "../runtime/process";
import { SandboxTerminalApi } from "../runtime/terminal";
import { BasicResponse } from "../types/session";
import {
  CreateSandboxParams,
  SandboxDetail,
  SandboxExecParams,
  SandboxListParams,
  SandboxListResponse,
  SandboxProcessResult,
  SandboxRuntimeSession,
  StartSandboxFromSnapshotParams,
} from "../types/sandbox";
import { BaseService } from "./base";

const RUNTIME_SESSION_REFRESH_BUFFER_MS = 60_000;

export class SandboxHandle {
  public readonly processes: SandboxProcessesApi;
  public readonly files: SandboxFilesApi;
  public readonly terminal: SandboxTerminalApi;
  public readonly pty: SandboxTerminalApi;
  private readonly transport: RuntimeTransport;
  private detail: SandboxDetail;
  private runtimeSession: SandboxRuntimeSession;

  constructor(
    private readonly service: SandboxesService,
    detail: SandboxDetail
  ) {
    this.detail = detail;
    this.runtimeSession = SandboxHandle.toRuntimeSession(detail);
    this.transport = new RuntimeTransport(
      (forceRefresh) => this.resolveRuntimeConnection(forceRefresh),
      service.runtimeTimeout
    );
    this.processes = new SandboxProcessesApi(this.transport);
    this.files = new SandboxFilesApi(
      this.transport,
      () => this.resolveRuntimeSocketConnectionInfo()
    );
    this.terminal = new SandboxTerminalApi(
      this.transport,
      () => this.resolveRuntimeSocketConnectionInfo()
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

  async stop(): Promise<BasicResponse> {
    const response = await this.service.stop(this.id);
    this.detail = {
      ...this.detail,
      status: "closed",
    };
    return response;
  }

  async delete(): Promise<BasicResponse> {
    const response = await this.service.delete(this.id);
    this.detail = {
      ...this.detail,
      status: "closed",
    };
    return response;
  }

  async createRuntimeSession(forceRefresh: boolean = false): Promise<SandboxRuntimeSession> {
    if (!forceRefresh && !this.isRuntimeSessionExpiring()) {
      return { ...this.runtimeSession };
    }

    const session = await this.service.getRuntimeSession(this.id);
    this.runtimeSession = session;
    this.detail = {
      ...this.detail,
      status: session.status,
      region: session.region,
      runtime: session.runtime,
      token: session.token,
      tokenExpiresAt: session.tokenExpiresAt,
    };
    return { ...session };
  }

  async exec(
    input: string | SandboxExecParams
  ): Promise<SandboxProcessResult> {
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
    const session = await this.createRuntimeSession(forceRefresh);
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
    const session = await this.createRuntimeSession();
    return {
      sandboxId: this.id,
      baseUrl: session.runtime.baseUrl,
      token: session.token,
    };
  }

  private isRuntimeSessionExpiring(): boolean {
    if (!this.runtimeSession.tokenExpiresAt) {
      return false;
    }

    const expiresAt = Date.parse(this.runtimeSession.tokenExpiresAt);
    if (Number.isNaN(expiresAt)) {
      return false;
    }

    return expiresAt - Date.now() <= RUNTIME_SESSION_REFRESH_BUFFER_MS;
  }

  private static toRuntimeSession(detail: SandboxDetail): SandboxRuntimeSession {
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

  constructor(apiKey: string, baseUrl: string, timeout: number) {
    super(apiKey, baseUrl, timeout);
    this.runtimeTimeout = timeout;
  }

  async create(params: CreateSandboxParams): Promise<SandboxHandle> {
    const detail = await this.createDetail(params);
    return this.attach(detail);
  }

  async startFromSnapshot(
    params: StartSandboxFromSnapshotParams
  ): Promise<SandboxHandle> {
    const detail = await this.startFromSnapshotDetail(params);
    return this.attach(detail);
  }

  async get(id: string): Promise<SandboxHandle> {
    const detail = await this.getDetail(id);
    return this.attach(detail);
  }

  async list(params: SandboxListParams = {}): Promise<SandboxListResponse> {
    try {
      return await this.request<SandboxListResponse>("/sandboxes", undefined, {
        status: params.status,
        page: params.page,
        limit: params.limit,
        search: params.search,
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError("Failed to list sandboxes", undefined);
    }
  }

  async stop(id: string): Promise<BasicResponse> {
    try {
      return await this.request<BasicResponse>(`/sandboxes/${id}/stop`, {
        method: "POST",
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to stop sandbox ${id}`, undefined);
    }
  }

  async delete(id: string): Promise<BasicResponse> {
    try {
      return await this.request<BasicResponse>(`/sandboxes/${id}`, {
        method: "DELETE",
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to delete sandbox ${id}`, undefined);
    }
  }

  async getRuntimeSession(id: string): Promise<SandboxRuntimeSession> {
    try {
      return await this.request<SandboxRuntimeSession>(
        `/sandboxes/${id}/runtime-session`,
        {
          method: "POST",
        }
      );
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(
        `Failed to create runtime session for sandbox ${id}`,
        undefined
      );
    }
  }

  async getDetail(id: string): Promise<SandboxDetail> {
    try {
      return await this.request<SandboxDetail>(`/sandboxes/${id}`);
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

  private async createDetail(params: CreateSandboxParams): Promise<SandboxDetail> {
    try {
      return await this.request<SandboxDetail>("/sandboxes", {
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

  private async startFromSnapshotDetail(
    params: StartSandboxFromSnapshotParams
  ): Promise<SandboxDetail> {
    try {
      return await this.request<SandboxDetail>("/sandboxes/startFromSnapshot", {
        method: "POST",
        body: JSON.stringify(params),
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError("Failed to start sandbox from snapshot", undefined);
    }
  }
}
