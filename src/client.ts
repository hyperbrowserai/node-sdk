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

export class HyperbrowserError extends Error {
  constructor(
    message: string,
    public statusCode?: number
  ) {
    super(`[Hyperbrowser]: ${message}`);
    this.name = "HyperbrowserError";
  }
}

export class HyperbrowserClient {
  public readonly sessions: SessionsService;
  public readonly scrape: ScrapeService;
  public readonly crawl: CrawlService;
  public readonly extract: ExtractService;
  public readonly profiles: ProfilesService;
  public readonly extensions: ExtensionService;
  public readonly agents: {
    browserUse: BrowserUseService;
    claudeComputerUse: ClaudeComputerUseService;
    cua: CuaService;
    hyperAgent: HyperAgentService;
  };
  public readonly team: TeamService;

  constructor(config: HyperbrowserConfig = {}) {
    const apiKey = config.apiKey || process.env["HYPERBROWSER_API_KEY"];
    const baseUrl = config.baseUrl || "https://api.hyperbrowser.ai";
    const timeout = config.timeout || 30000;
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
    this.team = new TeamService(apiKey, baseUrl, timeout);

    this.agents = {
      browserUse: new BrowserUseService(apiKey, baseUrl, timeout),
      claudeComputerUse: new ClaudeComputerUseService(apiKey, baseUrl, timeout),
      cua: new CuaService(apiKey, baseUrl, timeout),
      hyperAgent: new HyperAgentService(apiKey, baseUrl, timeout),
    };
  }
}
