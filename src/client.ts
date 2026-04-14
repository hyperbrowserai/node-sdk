import { HyperbrowserConfig } from "./types/config";
import { ControlAuthError, resolveControlPlaneConfig } from "./control-auth";
import { SessionsService } from "./services/sessions";
import { ScrapeService } from "./services/scrape";
import { CrawlService } from "./services/crawl";
import { ProfilesService } from "./services/profiles";
import { ExtensionService } from "./services/extensions";
import { ExtractService } from "./services/extract";
import { BrowserUseService } from "./services/agents/browser-use";
import { CuaService } from "./services/agents/cua";
import { ClaudeComputerUseService } from "./services/agents/claude-computer-use";
import { HyperAgentService } from "./services/agents/hyper-agent";
import { TeamService } from "./services/team";
import { ComputerActionService } from "./services/computer-action";
import { GeminiComputerUseService } from "./services/agents/gemini-computer-use";
import { WebService } from "./services/web";
import { SandboxesService } from "./services/sandboxes";
import { VolumesService } from "./services/volumes";

export type HyperbrowserService = "control" | "runtime";

export interface HyperbrowserErrorOptions {
  statusCode?: number;
  code?: string;
  requestId?: string;
  retryable?: boolean;
  service?: HyperbrowserService;
  details?: unknown;
  cause?: unknown;
}

export class HyperbrowserError extends Error {
  public readonly statusCode?: number;
  public readonly code?: string;
  public readonly requestId?: string;
  public readonly retryable: boolean;
  public readonly service?: HyperbrowserService;
  public readonly details?: unknown;
  public readonly cause?: unknown;

  constructor(message: string, options: number | HyperbrowserErrorOptions = {}) {
    super(`[Hyperbrowser]: ${message}`);
    this.name = "HyperbrowserError";

    const normalized = typeof options === "number" ? { statusCode: options } : options;

    this.statusCode = normalized.statusCode;
    this.code = normalized.code;
    this.requestId = normalized.requestId;
    this.retryable = normalized.retryable ?? false;
    this.service = normalized.service;
    this.details = normalized.details;
    this.cause = normalized.cause;
  }
}

export class HyperbrowserClient {
  public readonly sessions: SessionsService;
  public readonly scrape: ScrapeService;
  public readonly crawl: CrawlService;
  public readonly extract: ExtractService;
  public readonly profiles: ProfilesService;
  public readonly extensions: ExtensionService;
  public readonly web: WebService;
  public readonly agents: {
    browserUse: BrowserUseService;
    claudeComputerUse: ClaudeComputerUseService;
    cua: CuaService;
    hyperAgent: HyperAgentService;
    geminiComputerUse: GeminiComputerUseService;
  };
  public readonly team: TeamService;
  public readonly computerAction: ComputerActionService;
  public readonly sandboxes: SandboxesService;
  public readonly volumes: VolumesService;

  constructor(config: HyperbrowserConfig = {}) {
    let authManager: ReturnType<typeof resolveControlPlaneConfig>["authManager"];
    let baseUrl = "";
    try {
      const resolved = resolveControlPlaneConfig(config);
      authManager = resolved.authManager;
      baseUrl = resolved.baseUrl;
    } catch (error) {
      if (error instanceof ControlAuthError) {
        throw new HyperbrowserError(error.message, {
          statusCode: error.statusCode,
          code: error.code,
          retryable: error.retryable,
          service: "control",
          details: error.details,
          cause: error.cause ?? error,
        });
      }
      throw error;
    }
    const timeout = config.timeout || 30000;
    const runtimeProxyOverride = config.runtimeProxyOverride?.trim() || undefined;

    this.sessions = new SessionsService(authManager, baseUrl, timeout);
    this.scrape = new ScrapeService(authManager, baseUrl, timeout);
    this.crawl = new CrawlService(authManager, baseUrl, timeout);
    this.extract = new ExtractService(authManager, baseUrl, timeout);
    this.profiles = new ProfilesService(authManager, baseUrl, timeout);
    this.extensions = new ExtensionService(authManager, baseUrl, timeout);
    this.web = new WebService(authManager, baseUrl, timeout);
    this.team = new TeamService(authManager, baseUrl, timeout);
    this.computerAction = new ComputerActionService(authManager, baseUrl, timeout);
    this.sandboxes = new SandboxesService(authManager, baseUrl, timeout, runtimeProxyOverride);
    this.volumes = new VolumesService(authManager, baseUrl, timeout);

    this.agents = {
      browserUse: new BrowserUseService(authManager, baseUrl, timeout),
      claudeComputerUse: new ClaudeComputerUseService(authManager, baseUrl, timeout),
      cua: new CuaService(authManager, baseUrl, timeout),
      hyperAgent: new HyperAgentService(authManager, baseUrl, timeout),
      geminiComputerUse: new GeminiComputerUseService(authManager, baseUrl, timeout),
    };
  }
}
