export const SCRAPE_OPTIONS = {
  type: "object",
  description: "The options for the scrape",
  properties: {
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
  required: ["includeTags", "excludeTags", "onlyMainContent"],
  additionalProperties: false,
};

export const SCRAPE_SCHEMA = {
  type: "object" as const,
  properties: {
    url: {
      type: "string",
      description: "The URL of the website to scrape",
    },
    scrapeOptions: SCRAPE_OPTIONS,
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
    scrapeOptions: SCRAPE_OPTIONS,
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
