import {
  SCRAPE_TOOL_OPENAI,
  CRAWL_TOOL_OPENAI,
  EXTRACT_TOOL_OPENAI,
  BROWSER_USE_TOOL_OPENAI,
  SCREENSHOT_TOOL_OPENAI,
  OPENAI_CUA_TOOL_OPENAI,
  CLAUDE_COMPUTER_USE_TOOL_OPENAI,
  FILL_CREDENTIAL_TOOL_OPENAI,
} from "./openai";
import {
  SCRAPE_TOOL_ANTHROPIC,
  CRAWL_TOOL_ANTHROPIC,
  EXTRACT_TOOL_ANTHROPIC,
  BROWSER_USE_TOOL_ANTHROPIC,
  SCREENSHOT_TOOL_ANTHROPIC,
  CLAUDE_COMPUTER_USE_TOOL_ANTHROPIC,
  OPENAI_CUA_TOOL_ANTHROPIC,
  FILL_CREDENTIAL_TOOL_ANTHROPIC,
} from "./anthropic";
import { FILL_CREDENTIAL_TOOL_GEMINI } from "./gemini";
import { HyperbrowserClient, HyperbrowserError } from "../client";
import {
  StartScrapeJobParams,
  StartCrawlJobParams,
  StartBrowserUseTaskParams,
  StartCuaTaskParams,
  StartClaudeComputerUseTaskParams,
} from "../types";
import { StartExtractJobParams } from "../types/extract";
import { FillCredentialParams } from "../types/credential";

export { FILL_CREDENTIAL_DESCRIPTION, FILL_CREDENTIAL_SCHEMA } from "./schema";
export { FILL_CREDENTIAL_TOOL_OPENAI } from "./openai";
export { FILL_CREDENTIAL_TOOL_ANTHROPIC } from "./anthropic";
export * from "./gemini";

/** What the model passes to `fill_credential`. */
export interface CredentialFillToolParams {
  credential: string;
  fields: { field: string; selector: string }[];
  page_id?: string | null;
  frame_url?: string | null;
}

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
    return resp.data?.finalResult || resp.error || "";
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
    return resp.data?.finalResult || resp.error || "";
  }
}

export class OpenAICuaTool {
  static openaiToolDefinition = OPENAI_CUA_TOOL_OPENAI;
  static anthropicToolDefinition = OPENAI_CUA_TOOL_ANTHROPIC;

  static async runnable(hb: HyperbrowserClient, params: StartCuaTaskParams): Promise<string> {
    const resp = await hb.agents.cua.startAndWait(params);
    return resp.data?.finalResult || resp.error || "";
  }
}

/**
 * Lets a model fill a credential attached to a browser session. The
 * application binds the session; the model chooses only the credential name,
 * fields and selectors, and never sees values.
 */
export class CredentialFillTool {
  static openaiToolDefinition = FILL_CREDENTIAL_TOOL_OPENAI;
  static anthropicToolDefinition = FILL_CREDENTIAL_TOOL_ANTHROPIC;
  static geminiToolDefinition = FILL_CREDENTIAL_TOOL_GEMINI;

  /**
   * Run a `fill_credential` call in `sessionId` and return the result as JSON
   * text for the model. API and validation errors come back as
   * `{"error": {"code", "message", "retryable", "details"}}` rather than
   * being thrown, so the model can react to them.
   */
  static async runnable(
    hb: HyperbrowserClient,
    sessionId: string,
    params: CredentialFillToolParams
  ): Promise<string> {
    try {
      // Model output is checked by fill; only the known keys are passed on.
      const input: Partial<CredentialFillToolParams> = params ?? {};
      const request: FillCredentialParams = {
        credential: input.credential as string,
        fields: (Array.isArray(input.fields)
          ? input.fields.map((entry) => ({ field: entry?.field, selector: entry?.selector }))
          : input.fields) as FillCredentialParams["fields"],
      };
      if (input.page_id !== undefined && input.page_id !== null) {
        request.pageId = input.page_id;
      }
      if (input.frame_url !== undefined && input.frame_url !== null) {
        request.frame = { url: input.frame_url };
      }
      return JSON.stringify(await hb.sessions.credentials.fill(sessionId, request));
    } catch (error) {
      if (!(error instanceof HyperbrowserError)) {
        throw error;
      }
      return JSON.stringify({
        error: {
          code: error.code ?? null,
          message: error.message.replace(/^\[Hyperbrowser\]: /, ""),
          retryable: error.retryable,
          details: error.details ?? null,
        },
      });
    }
  }
}
