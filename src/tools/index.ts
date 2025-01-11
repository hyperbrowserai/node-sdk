import { SCRAPE_TOOL_OPENAI, CRAWL_TOOL_OPENAI } from "./openai";
import { SCRAPE_TOOL_ANTHROPIC, CRAWL_TOOL_ANTHROPIC } from "./anthropic";
import { HyperbrowserClient } from "../client";
import { StartScrapeJobParams, StartCrawlJobParams } from "../types";

export class WebsiteScrapeTool {
  static openaiToolDefinition = SCRAPE_TOOL_OPENAI;
  static anthropicToolDefinition = SCRAPE_TOOL_ANTHROPIC;

  static async runnable(hb: HyperbrowserClient, params: StartScrapeJobParams): Promise<string> {
    const resp = await hb.scrape.startAndWait(params);
    return resp.data?.markdown || "";
  }
}

export class WebsiteCrawlTool {
  static openaiToolDefinition = CRAWL_TOOL_OPENAI;
  static anthropicToolDefinition = CRAWL_TOOL_ANTHROPIC;

  static async runnable(hb: HyperbrowserClient, params: StartCrawlJobParams): Promise<string> {
    const resp = await hb.crawl.startAndWait(params);
    let markdown = "";

    if (resp.data) {
      for (const page of resp.data) {
        if (page.markdown) {
          markdown += `\n${"-".repeat(50)}\nUrl: ${page.url}\nMarkdown:\n${page.markdown}\n`;
        }
      }
    }
    return markdown;
  }
}
