import { Response } from "node-fetch";
import { HyperbrowserConfig } from "./types/config";
import { SessionsService } from "./services/sessions";
import { ScrapeService } from "./services/scrape";
import { CrawlService } from "./services/crawl";
import { ProfilesService } from "./services/profiles";

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
  public readonly profiles: ProfilesService;

  constructor(config: HyperbrowserConfig) {
    const apiKey = config.apiKey;
    const baseUrl = config.baseUrl || "https://app.hyperbrowser.ai";
    const timeout = config.timeout || 30000;
    if (!apiKey) {
      throw new HyperbrowserError("API key is required");
    }

    this.sessions = new SessionsService(apiKey, baseUrl, timeout);
    this.scrape = new ScrapeService(apiKey, baseUrl, timeout);
    this.crawl = new CrawlService(apiKey, baseUrl, timeout);
    this.profiles = new ProfilesService(apiKey, baseUrl, timeout);
  }
}
