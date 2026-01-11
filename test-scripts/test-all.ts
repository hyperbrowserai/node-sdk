/**
 * Throwaway test script to test all web functionality
 * Run with: npx ts-node test-scripts/test-all.ts
 */

import { HyperbrowserClient } from "../src/client";

async function testAll() {
  const apiKey = process.env.HYPERBROWSER_API_KEY;
  if (!apiKey) {
    console.error("Please set HYPERBROWSER_API_KEY environment variable");
    process.exit(1);
  }

  const client = new HyperbrowserClient({ apiKey });

  console.log("🧪 Testing all web functionality...\n");

  try {
    // Test web.fetch
    console.log("1️⃣  Testing web.fetch...");
    const fetchResult = await client.web.fetch({
      url: "https://example.com",
      outputs: ["markdown"],
    });
    console.log("   ✅ web.fetch works - Job ID:", fetchResult.jobId);

    // Test web.search
    console.log("\n2️⃣  Testing web.search...");
    const searchResult = await client.web.search({
      query: "test query",
      page: 1,
    });
    console.log("   ✅ web.search works - Status:", searchResult.status);

    // Test web.batchFetch.start
    console.log("\n3️⃣  Testing web.batchFetch.start...");
    const batchStartResult = await client.web.batchFetch.start({
      urls: ["https://example.com"],
      outputs: ["markdown"],
    });
    console.log("   ✅ web.batchFetch.start works - Job ID:", batchStartResult.jobId);

    // Test web.batchFetch.getStatus
    console.log("\n4️⃣  Testing web.batchFetch.getStatus...");
    const batchStatusResult = await client.web.batchFetch.getStatus(batchStartResult.jobId);
    console.log("   ✅ web.batchFetch.getStatus works - Status:", batchStatusResult.status);

    // Test web.batchFetch.get
    console.log("\n5️⃣  Testing web.batchFetch.get...");
    const batchGetResult = await client.web.batchFetch.get(batchStartResult.jobId);
    console.log("   ✅ web.batchFetch.get works - Total pages:", batchGetResult.totalPages);

    console.log("\n🎉 All tests passed! The web service is working correctly.");
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    if (error instanceof Error) {
      console.error("   Error message:", error.message);
      console.error("   Error name:", error.name);
    }
    process.exit(1);
  }
}

testAll();
