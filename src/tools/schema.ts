export const OPENAI_CUA_DESCRIPTION = `This tool utilizes OpenAI's model to autonomously execute general-purpose browser-based tasks with balanced performance and reliability using a cloud browser. It handles complex interactions effectively with practical reasoning and clear execution.

Optimal for tasks requiring:
- Reliable, general-purpose browser automation
- Clear, structured interactions with moderate complexity
- Efficient handling of common web tasks and workflows

Best suited use cases include:
- Standard multi-step registration or form submissions
- Navigating typical web applications requiring multiple interactions
- Conducting structured web research tasks
- Extracting data through interactive web processes

Provide a clear step-by-step description, necessary context, and expected outcomes. Returns the completed result or an error message if issues arise.`;

export const CLAUDE_COMPUTER_USE_DESCRIPTION = `
This tool leverages Anthropic's Claude model to autonomously execute complex browser tasks with sophisticated reasoning capabilities using a cloud browser. It specializes in handling intricate, nuanced, or highly context-sensitive web interactions.

Optimal for tasks requiring:
- Complex reasoning over multiple web pages
- Nuanced interpretation and flexible decision-making
- Human-like interaction with detailed context awareness

Best suited use cases include:
- Multi-step processes requiring reasoning (e.g., detailed registrations or onboarding)
- Interacting intelligently with advanced web apps
- Conducting in-depth research with complex conditions
- Extracting information from dynamic or interactive websites

Provide detailed task instructions, relevant context, and clearly specify the desired outcome for best results. Returns the completed result or an error message if issues arise.`;

function getScrapeOptions(formats: Array<"markdown" | "screenshot"> = ["markdown"]) {
  return {
    type: "object",
    description: "The options for the scrape",
    properties: {
      formats: {
        type: "array",
        description: "The format of the content to scrape",
        items: {
          type: "string",
          enum: formats,
        },
      },
      includeTags: {
        type: "array",
        items: {
          type: "string",
        },
        description:
          "An array of HTML tags, classes, or IDs to include in the scraped content. Only elements matching these selectors will be returned.",
      },
      excludeTags: {
        type: "array",
        items: {
          type: "string",
        },
        description:
          "An array of HTML tags, classes, or IDs to exclude from the scraped content. Elements matching these selectors will be omitted from the response.",
      },
      onlyMainContent: {
        type: "boolean",
        description:
          "Whether to only return the main content of the page. If true, only the main content of the page will be returned, excluding any headers, navigation menus,footers, or other non-main content.",
      },
    },
    required: ["includeTags", "excludeTags", "onlyMainContent", "formats"],
    additionalProperties: false,
  };
}

const SESSION_OPTIONS = {
  type: "object",
  description: "The options for the browser session that will be used.",
  properties: {
    useProxy: {
      type: "boolean",
      description:
        "Recommended false. Avoid setting this if not explicitly mentioned. Whether to use residential proxies to access the internet. Enabling this helps avoid getting detected as a bot.",
    },
  },
  required: ["useProxy"],
  additionalProperties: false,
};

export const SCRAPE_SCHEMA = {
  type: "object" as const,
  properties: {
    url: {
      type: "string",
      description: "The URL of the website to scrape",
    },
    scrapeOptions: getScrapeOptions(),
  },
  required: ["url", "scrapeOptions"],
  additionalProperties: false,
};

export const SCREENSHOT_SCHEMA = {
  type: "object" as const,
  properties: {
    url: {
      type: "string",
      description: "The URL of the website to scrape",
    },
    scrapeOptions: getScrapeOptions(["screenshot"]),
  },
  required: ["url", "scrapeOptions"],
  additionalProperties: false,
};

export const CRAWL_SCHEMA = {
  type: "object" as const,
  properties: {
    url: {
      type: "string",
      description: "The URL of the website to crawl",
    },
    maxPages: {
      type: "number",
      description: "The maximum number of pages to crawl",
    },
    followLinks: {
      type: "boolean",
      description: "Whether to follow links on the page",
    },
    ignoreSitemap: {
      type: "boolean",
      description: "Whether to ignore the sitemap",
    },
    excludePatterns: {
      type: "array",
      items: {
        type: "string",
      },
      description:
        "An array of regular expressions or wildcard patterns specifying which URLs should be excluded from the crawl. Any pages whose URLs' path match one of these patterns will be skipped. Example: ['/admin', '/careers/*']",
    },
    includePatterns: {
      type: "array",
      items: {
        type: "string",
      },
      description:
        "An array of regular expressions or wildcard patterns specifying which URLs should be included in the crawl. Only pages whose URLs' path match one of these path patterns will be visited. Example: ['/admin', '/careers/*']",
    },
    scrapeOptions: getScrapeOptions(),
  },
  required: [
    "url",
    "maxPages",
    "followLinks",
    "ignoreSitemap",
    "excludePatterns",
    "includePatterns",
    "scrapeOptions",
  ],
  additionalProperties: false,
};

export const EXTRACT_SCHEMA = {
  type: "object" as const,
  properties: {
    urls: {
      type: "array",
      items: {
        type: "string",
      },
      description:
        "A required list of up to 10 urls you want to process IN A SINGLE EXTRACTION. When answering questions that involve multiple sources or topics, ALWAYS include ALL relevant URLs in this single array rather than making separate function calls. This enables cross-referencing information across multiple sources to provide comprehensive answers. To allow crawling for any of the urls provided in the list, simply add /* to the end of the url (https://hyperbrowser.ai/*). This will crawl other pages on the site with the same origin and find relevant pages to use for the extraction context.",
    },
    prompt: {
      type: "string",
      description:
        "A prompt describing how you want the data structured, or what you want to extract from the urls provided. Can also be used to guide the extraction process. For multi-source queries, structure this prompt to request unified, comparative, or aggregated information across all provided URLs.",
    },
    schema: {
      type: "string",
      description:
        "A strict json schema you want the returned data to be structured as. For multi-source extraction, design this schema to accommodate information from all URLs in a single structure. Ensure that this is a proper json schema, and the root level should be of type 'object'.",
    },
    maxLinks: {
      type: "number",
      description:
        "The maximum number of links to look for if performing a crawl for any given url in the urls list.",
    },
  },
  required: ["urls", "prompt", "schema", "maxLinks"],
  additionalProperties: false,
};

const BROWSER_USE_LLM_SCHEMA = {
  type: "string",
  enum: [
    "gpt-4o",
    "gpt-4o-mini",
    "claude-3-7-sonnet-20250219",
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
    "gemini-2.0-flash",
  ],
  default: "gemini-2.0-flash",
};

export const BROWSER_USE_SCHEMA = {
  type: "object" as const,
  properties: {
    task: {
      type: "string",
      description: "The text description of the task to be performed by the agent.",
    },
    llm: {
      ...BROWSER_USE_LLM_SCHEMA,
      description:
        "The language model (LLM) instance to use for generating actions. Default to gemini-2.0-flash.",
    },
    plannerLlm: {
      ...BROWSER_USE_LLM_SCHEMA,
      description:
        "The language model to use specifically for planning future actions, can differ from the main LLM. Default to gemini-2.0-flash.",
    },
    pageExtractionLlm: {
      ...BROWSER_USE_LLM_SCHEMA,
      description:
        "The language model to use for extracting structured data from webpages. Default to gemini-2.0-flash.",
    },
    keepBrowserOpen: {
      type: "boolean",
      description: "When enabled, keeps the browser session open after task completion.",
    },
  },
  required: ["task", "llm", "plannerLlm", "pageExtractionLlm", "keepBrowserOpen"],
  additionalProperties: false,
};

export const CLAUDE_COMPUTER_USE_SCHEMA = {
  type: "object" as const,
  properties: {
    task: {
      type: "string",
      description: "The text description of the task to be performed by the agent.",
    },
    sessionOptions: SESSION_OPTIONS,
  },
  required: ["task", "sessionOptions"],
  additionalProperties: false,
};

export const OPENAI_CUA_SCHEMA = {
  type: "object" as const,
  properties: {
    task: {
      type: "string",
      description: "The text description of the task to be performed by the agent.",
    },
    sessionOptions: SESSION_OPTIONS,
  },
  required: ["task", "sessionOptions"],
  additionalProperties: false,
};
