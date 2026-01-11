/**
 * Throwaway test script for web.search functionality
 * Run with: npx ts-node test-scripts/test-web-search.ts
 */

import { HyperbrowserClient } from "../src/client";

async function testWebSearch() {
  const apiKey = process.env.HYPERBROWSER_API_KEY;
  if (!apiKey) {
    console.error("Please set HYPERBROWSER_API_KEY environment variable");
    process.exit(1);
  }

  const client = new HyperbrowserClient({ apiKey });

  try {
    console.log("Testing web.search...");

    // Test 1: Basic search
    const result1 = await client.web.search({
      query: "nodejs tutorials",
      page: 1,
    });

    console.log("Basic search result:", {
      status: result1.status,
      query: result1.data?.query,
      resultsCount: result1.data?.results?.length || 0,
      firstResult: result1.data?.results?.[0]
        ? {
            title: result1.data.results[0].title,
            url: result1.data.results[0].url,
          }
        : null,
    });

    // Test 2: Search with filters
    const result2 = await client.web.search({
      query: "typescript",
      page: 1,
      filters: {
        site: "github.com",
        filetype: "pdf",
      },
    });

    console.log("Search with filters:", {
      status: result2.status,
      resultsCount: result2.data?.results?.length || 0,
    });

    // Test 3: Search with region
    const result3 = await client.web.search({
      query: "web scraping",
      page: 1,
      region: {
        country: "US",
        state: "CA",
      },
      filters: {
        exactPhrase: true,
      },
    });

    console.log("Search with region:", {
      status: result3.status,
      resultsCount: result3.data?.results?.length || 0,
    });

    // Test 4: Search with multiple filters
    const result4 = await client.web.search({
      query: "react hooks",
      page: 1,
      maxAgeSeconds: 86400, // 24 hours
      filters: {
        excludeTerms: ["vue", "angular"],
        boostTerms: ["typescript"],
        intitle: "react",
      },
    });

    console.log("Search with multiple filters:", {
      status: result4.status,
      resultsCount: result4.data?.results?.length || 0,
    });

    console.log("\n✅ All web.search tests completed successfully!");
  } catch (error) {
    console.error("❌ Error testing web.search:", error);
    process.exit(1);
  }
}

testWebSearch();
