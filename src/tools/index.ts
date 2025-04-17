import {
  SCRAPE_TOOL_OPENAI,
  CRAWL_TOOL_OPENAI,
  EXTRACT_TOOL_OPENAI,
  BROWSER_USE_TOOL_OPENAI,
  SCREENSHOT_TOOL_OPENAI,
  OPENAI_CUA_TOOL_OPENAI,
  CLAUDE_COMPUTER_USE_TOOL_OPENAI,
} from "./openai";
import {
  SCRAPE_TOOL_ANTHROPIC,
  CRAWL_TOOL_ANTHROPIC,
  EXTRACT_TOOL_ANTHROPIC,
  BROWSER_USE_TOOL_ANTHROPIC,
  SCREENSHOT_TOOL_ANTHROPIC,
  CLAUDE_COMPUTER_USE_TOOL_ANTHROPIC,
  OPENAI_CUA_TOOL_ANTHROPIC,
} from "./anthropic";
import { HyperbrowserClient } from "../client";
import {
  StartScrapeJobParams,
  StartCrawlJobParams,
  StartBrowserUseTaskParams,
  StartCuaTaskParams,
  StartClaudeComputerUseTaskParams,
} from "../types";
import { StartExtractJobParams } from "../types/extract";

export class WebsiteScrapeTool {
  static openaiToolDefinition = SCRAPE_TOOL_OPENAI;
  static anthropicToolDefinition = SCRAPE_TOOL_ANTHROPIC;

  static async runnable(hb: HyperbrowserClient, params: StartScrapeJobParams): Promise<string> {
    const resp = await hb.scrape.startAndWait(params);
    return resp.data?.markdown || "";
  }
}

export class WebsiteScreenshotTool {
  static openaiToolDefinition = SCREENSHOT_TOOL_OPENAI;
  static anthropicToolDefinition = SCREENSHOT_TOOL_ANTHROPIC;

  static async runnable(hb: HyperbrowserClient, params: StartScrapeJobParams): Promise<string> {
    const resp = await hb.scrape.startAndWait(params);
    return resp.data?.screenshot || "";
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

export class WebsiteExtractTool {
  static openaiToolDefinition = EXTRACT_TOOL_OPENAI;
  static anthropicToolDefinition = EXTRACT_TOOL_ANTHROPIC;

  static async runnable(hb: HyperbrowserClient, params: StartExtractJobParams): Promise<string> {
    if (params.schema && typeof params.schema === "string") {
      params.schema = JSON.parse(params.schema);
    }
    const resp = await hb.extract.startAndWait(params);
    return resp.data ? JSON.stringify(resp.data) : "";
  }
}

export class BrowserUseTool {
  static openaiToolDefinition = BROWSER_USE_TOOL_OPENAI;
  static anthropicToolDefinition = BROWSER_USE_TOOL_ANTHROPIC;

  static async runnable(
    hb: HyperbrowserClient,
    params: StartBrowserUseTaskParams
  ): Promise<string> {
    const resp = await hb.agents.browserUse.startAndWait(params);
    return resp.data?.finalResult || "";
  }
}

export class ClaudeComputerUseTool {
  static openaiToolDefinition = CLAUDE_COMPUTER_USE_TOOL_OPENAI;
  static anthropicToolDefinition = CLAUDE_COMPUTER_USE_TOOL_ANTHROPIC;

  static async runnable(
    hb: HyperbrowserClient,
    params: StartClaudeComputerUseTaskParams
  ): Promise<string> {
    const resp = await hb.agents.claudeComputerUse.startAndWait(params);
    return resp.data?.finalResult || "";
  }
}

export class OpenAICuaTool {
  static openaiToolDefinition = OPENAI_CUA_TOOL_OPENAI;
  static anthropicToolDefinition = OPENAI_CUA_TOOL_ANTHROPIC;

  static async runnable(hb: HyperbrowserClient, params: StartCuaTaskParams): Promise<string> {
    const resp = await hb.agents.cua.startAndWait(params);
    return resp.data?.finalResult || "";
  }
}
