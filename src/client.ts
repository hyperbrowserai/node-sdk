import { HyperbrowserConfig } from "./types/config";
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
import { GrokComputerUseService } from "./services/agents/grok-computer-use";
import { MetaComputerUseService } from "./services/agents/meta-computer-use";
import { JevComputerUseService } from "./services/agents/jev-computer-use";
import { WebService } from "./services/web";
import { SandboxesService } from "./services/sandboxes";
import { VolumesService } from "./services/volumes";

import { HyperbrowserError } from "./error";
export { HyperbrowserError } from "./error";
export type { HyperbrowserErrorOptions, HyperbrowserService } from "./error";

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
    grokComputerUse: GrokComputerUseService;
    metaComputerUse: MetaComputerUseService;
    jevComputerUse: JevComputerUseService;
  };
  public readonly team: TeamService;
  public readonly computerAction: ComputerActionService;
  public readonly sandboxes: SandboxesService;
  public readonly volumes: VolumesService;

  constructor(config: HyperbrowserConfig = {}) {
    const apiKey = config.apiKey || process.env["HYPERBROWSER_API_KEY"];
    const baseUrl =
      config.baseUrl || process.env["HYPERBROWSER_BASE_URL"] || "https://api.hyperbrowser.ai";
    const timeout = config.timeout || 30000;
    const runtimeProxyOverride = config.runtimeProxyOverride?.trim() || undefined;
    if (!apiKey) {
      throw new HyperbrowserError(
        "API key is required - either pass it in config or set HYPERBROWSER_API_KEY environment variable"
      );
    }

    this.sessions = new SessionsService(apiKey, baseUrl, timeout);
    this.scrape = new ScrapeService(apiKey, baseUrl, timeout);
    this.crawl = new CrawlService(apiKey, baseUrl, timeout);
    this.extract = new ExtractService(apiKey, baseUrl, timeout);
    this.profiles = new ProfilesService(apiKey, baseUrl, timeout);
    this.extensions = new ExtensionService(apiKey, baseUrl, timeout);
    this.web = new WebService(apiKey, baseUrl, timeout);
    this.team = new TeamService(apiKey, baseUrl, timeout);
    this.computerAction = new ComputerActionService(apiKey, baseUrl, timeout);
    this.sandboxes = new SandboxesService(apiKey, baseUrl, timeout, runtimeProxyOverride);
    this.volumes = new VolumesService(apiKey, baseUrl, timeout);

    this.agents = {
      browserUse: new BrowserUseService(apiKey, baseUrl, timeout),
      claudeComputerUse: new ClaudeComputerUseService(apiKey, baseUrl, timeout),
      cua: new CuaService(apiKey, baseUrl, timeout),
      hyperAgent: new HyperAgentService(apiKey, baseUrl, timeout),
      geminiComputerUse: new GeminiComputerUseService(apiKey, baseUrl, timeout),
      grokComputerUse: new GrokComputerUseService(apiKey, baseUrl, timeout),
      metaComputerUse: new MetaComputerUseService(apiKey, baseUrl, timeout),
      jevComputerUse: new JevComputerUseService(apiKey, baseUrl, timeout),
    };
  }
}
