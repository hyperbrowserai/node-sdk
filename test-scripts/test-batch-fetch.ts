/**
 * Throwaway test script for web.batchFetch functionality
 * Run with: npx ts-node test-scripts/test-batch-fetch.ts
 */

import { HyperbrowserClient } from "../src/client";

async function testBatchFetch() {
  const apiKey = process.env.HYPERBROWSER_API_KEY;
  if (!apiKey) {
    console.error("Please set HYPERBROWSER_API_KEY environment variable");
    process.exit(1);
  }

  const client = new HyperbrowserClient({ apiKey });

  try {
    console.log("Testing web.batchFetch...");

    const testUrls = [
      "https://example.com",
      "https://example.org",
      "https://example.net",
    ];

    // Test 1: Start batch fetch job
    console.log("Starting batch fetch job...");
    const startResult = await client.web.batchFetch.start({
      urls: testUrls,
      outputs: ["markdown"],
      fetchOptions: {
        waitFor: 1000,
      },
    });

    console.log("Batch fetch job started:", {
      jobId: startResult.jobId,
    });

    // Test 2: Get batch fetch job status
    console.log("Getting batch fetch job status...");
    const statusResult = await client.web.batchFetch.getStatus(startResult.jobId);
    console.log("Batch fetch job status:", {
      status: statusResult.status,
    });

    // Test 3: Get batch fetch job results (without waiting)
    console.log("Getting batch fetch job results...");
    const getResult = await client.web.batchFetch.get(startResult.jobId, {
      page: 1,
      batchSize: 10,
    });

    console.log("Batch fetch job results:", {
      jobId: getResult.jobId,
      status: getResult.status,
      totalPages: getResult.totalPages,
      totalPageBatches: getResult.totalPageBatches,
      currentPageBatch: getResult.currentPageBatch,
      batchSize: getResult.batchSize,
      pagesCount: getResult.data?.length || 0,
    });

    if (getResult.data && getResult.data.length > 0) {
      console.log("First page result:", {
        url: getResult.data[0].url,
        status: getResult.data[0].status,
        hasMarkdown: !!getResult.data[0].markdown,
      });
    }

    // Test 4: Start and wait for completion (commented out as it may take a while)
    // Uncomment to test the full wait functionality
    /*
    console.log("Starting batch fetch and waiting for completion...");
    const waitResult = await client.web.batchFetch.startAndWait(
      {
        urls: testUrls,
        outputs: ["markdown", "links"],
      },
      true // returnAllPages
    );

    console.log("Batch fetch completed:", {
      jobId: waitResult.jobId,
      status: waitResult.status,
      totalPages: waitResult.totalPages,
      pagesCount: waitResult.data?.length || 0,
    });
    */

    console.log("\n✅ All web.batchFetch tests completed successfully!");
  } catch (error) {
    console.error("❌ Error testing web.batchFetch:", error);
    process.exit(1);
  }
}

testBatchFetch();
