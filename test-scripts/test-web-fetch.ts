/**
 * Throwaway test script for web.fetch functionality
 * Run with: npx ts-node test-scripts/test-web-fetch.ts
 */

import { HyperbrowserClient } from "../src/client";

async function testWebFetch() {
  const apiKey = process.env.HYPERBROWSER_API_KEY;
  if (!apiKey) {
    console.error("Please set HYPERBROWSER_API_KEY environment variable");
    process.exit(1);
  }

  const client = new HyperbrowserClient({ apiKey });

  try {
    console.log("Testing web.fetch...");
    
    // Test 1: Basic fetch with markdown output
    const result1 = await client.web.fetch({
      url: "https://example.com",
      outputs: ["markdown"],
      fetchOptions: {
        waitFor: 1000,
      },
    });
    
    console.log("Fetch result:", {
      jobId: result1.jobId,
      status: result1.status,
      hasData: !!result1.data,
      hasMarkdown: !!result1.data?.markdown,
    });

    // Test 2: Fetch with multiple outputs
    const result2 = await client.web.fetch({
      url: "https://example.com",
      outputs: ["markdown", "links", "html"],
      fetchOptions: {
        waitUntil: "load",
        timeout: 30000,
      },
      sessionOptions: {
        useProxy: false,
        adblock: true,
      },
    });

    console.log("Fetch with multiple outputs:", {
      jobId: result2.jobId,
      status: result2.status,
      hasMarkdown: !!result2.data?.markdown,
      hasLinks: !!result2.data?.links,
      hasHtml: !!result2.data?.html,
      linksCount: result2.data?.links?.length || 0,
    });

    // Test 3: Fetch with screenshot
    const result3 = await client.web.fetch({
      url: "https://example.com",
      outputs: [
        {
          type: "screenshot",
          options: {
            fullPage: true,
            format: "png",
          },
        },
      ],
    });

    console.log("Fetch with screenshot:", {
      jobId: result3.jobId,
      status: result3.status,
      hasScreenshot: !!result3.data?.screenshot,
    });

    // Test 4: Fetch with JSON schema (Zod example)
    const result4 = await client.web.fetch({
      url: "https://example.com",
      outputs: [
        {
          type: "json",
          options: {
            schema: {
              type: "object",
              properties: {
                title: { type: "string" },
                description: { type: "string" },
              },
            },
          },
        },
      ],
    });

    console.log("Fetch with JSON schema:", {
      jobId: result4.jobId,
      status: result4.status,
      hasJson: !!result4.data?.json,
    });

    console.log("\n✅ All web.fetch tests completed successfully!");
  } catch (error) {
    console.error("❌ Error testing web.fetch:", error);
    process.exit(1);
  }
}

testWebFetch();
