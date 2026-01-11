# Test Scripts

These are throwaway test scripts to verify the web.fetch and web.search functionality works correctly.

## Prerequisites

1. Set your API key as an environment variable:
   ```bash
   export HYPERBROWSER_API_KEY="your-api-key-here"
   ```

2. Make sure dependencies are installed:
   ```bash
   yarn install
   ```

## Running Tests

### Test all functionality
```bash
npx ts-node test-scripts/test-all.ts
```

### Test individual features

**Test web.fetch:**
```bash
npx ts-node test-scripts/test-web-fetch.ts
```

**Test web.search:**
```bash
npx ts-node test-scripts/test-web-search.ts
```

**Test web.batchFetch:**
```bash
npx ts-node test-scripts/test-batch-fetch.ts
```

## What These Scripts Test

- ✅ `web.fetch()` - Single page fetch with various output types
- ✅ `web.search()` - Web search with filters and regions
- ✅ `web.batchFetch.start()` - Start a batch fetch job
- ✅ `web.batchFetch.getStatus()` - Get batch fetch job status
- ✅ `web.batchFetch.get()` - Get batch fetch job results
- ✅ `web.batchFetch.startAndWait()` - Start and wait for completion (commented out in test)

## Note

These are throwaway scripts for testing purposes. They can be deleted after verification.
