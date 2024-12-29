import { Response } from "node-fetch";
import { HyperbrowserConfig } from "./types/config";
import { SessionsService } from "./services/sessions";
import { ScrapeService } from "./services/scrape";
import { CrawlService } from "./services/crawl";
import { ContextsService } from "./services/contexts";

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
  public readonly contexts: ContextsService;

  constructor(config: HyperbrowserConfig) {
    const apiKey = config.apiKey;
    const baseUrl = config.baseUrl || "https://app.hyperbrowser.ai";

    if (!apiKey) {
      throw new HyperbrowserError("API key is required");
    }

    this.sessions = new SessionsService(apiKey, baseUrl);
    this.scrape = new ScrapeService(apiKey, baseUrl);
    this.crawl = new CrawlService(apiKey, baseUrl);
    this.contexts = new ContextsService(apiKey, baseUrl);
  }
}
