# Hyperbrowser Node SDK

Checkout the full documentation [here](https://hyperbrowser.ai/docs)

## Installation

Hyperbrowser can be installed via npm by running:

```bash
npm install @hyperbrowser/sdk
```

or

```bash
yarn add @hyperbrowser/sdk
```

## Usage

### Playwright

```typescript
import { chromium } from "playwright-core";
import { Hyperbrowser } from "@hyperbrowser/sdk";
import { config } from "dotenv";

config();

const client = new Hyperbrowser({
  apiKey: process.env.HYPERBROWSER_API_KEY,
});

const main = async () => {
  const session = await client.sessions.create();

  try {
    const browser = await chromium.connectOverCDP(session.wsEndpoint);

    const defaultContext = browser.contexts()[0];
    const page = await defaultContext.newPage();

    // Navigate to a website
    console.log("Navigating to Hacker News...");
    await page.goto("https://news.ycombinator.com/");
    const pageTitle = await page.title();
    console.log("Page 1:", pageTitle);
    await page.evaluate(() => {
      console.log("Page 1:", document.title);
    });

    await page.goto("https://example.com");
    console.log("Page 2:", await page.title());
    await page.evaluate(() => {
      console.log("Page 2:", document.title);
    });

    await page.goto("https://apple.com");
    console.log("Page 3:", await page.title());
    await page.evaluate(() => {
      console.log("Page 3:", document.title);
    });

    await page.goto("https://google.com");
    console.log("Page 4:", await page.title());
    await page.evaluate(() => {
      console.log("Page 4:", document.title);
    });
  } catch (err) {
    console.error(`Encountered error: ${err}`);
  } finally {
    await client.sessions.stop(session.id);
  }
};

main();
```

### Puppeteer

```typescript
import { connect } from "puppeteer-core";
import { Hyperbrowser } from "@hyperbrowser/sdk";
import { config } from "dotenv";

config();

const client = new Hyperbrowser({
  apiKey: process.env.HYPERBROWSER_API_KEY,
});

const main = async () => {
  const session = await client.sessions.create();

  try {
    const browser = await connect({
      browserWSEndpoint: session.wsEndpoint,
      defaultViewport: null,
    });

    const [page] = await browser.pages();

    // Navigate to a website
    console.log("Navigating to Hacker News...");
    await page.goto("https://news.ycombinator.com/");
    const pageTitle = await page.title();
    console.log("Page 1:", pageTitle);
    await page.evaluate(() => {
      console.log("Page 1:", document.title);
    });

    await page.goto("https://example.com");
    console.log("Page 2:", await page.title());
    await page.evaluate(() => {
      console.log("Page 2:", document.title);
    });

    await page.goto("https://apple.com");
    console.log("Page 3:", await page.title());
    await page.evaluate(() => {
      console.log("Page 3:", document.title);
    });

    await page.goto("https://google.com");
    console.log("Page 4:", await page.title());
    await page.evaluate(() => {
      console.log("Page 4:", document.title);
    });
  } catch (err) {
    console.error(`Encountered error: ${err}`);
  } finally {
    await client.sessions.stop(session.id);
  }
};

main();
```

### Sandboxes

For local sandbox development, you can explicitly route sandbox runtime traffic
through a regional proxy override:

```typescript
const client = new Hyperbrowser({
  apiKey: process.env.HYPERBROWSER_API_KEY,
  runtimeProxyOverride: process.env.REGIONAL_PROXY_DEV_HOST,
});
```

```typescript
import { Hyperbrowser } from "@hyperbrowser/sdk";

const client = new Hyperbrowser({
  apiKey: process.env.HYPERBROWSER_API_KEY,
});

const main = async () => {
  const sandbox = await client.sandboxes.create({
    imageName: "ubuntu-24-node",
    region: "us-west",
  });

  // Provide exactly one launch source:
  // sandboxName, snapshotName, or imageName.
  // snapshotId requires snapshotName and imageId requires imageName.

  const version = await sandbox.exec("node -v");
  console.log(version.stdout.trim());

  await sandbox.files.writeText("/tmp/hello.txt", "hello from sdk");

  const content = await sandbox.files.readText("/tmp/hello.txt");
  console.log(content);

  const watch = await sandbox.files.watchDir(
    "/tmp",
    (event) => {
      if (event.type === "write") {
        console.log(event.name);
      }
    },
    {
      recursive: false,
    }
  );

  await sandbox.files.writeText("/tmp/watch-demo.txt", "watch me");
  await watch.stop();

  const proc = await sandbox.processes.start({
    command: "bash",
    args: ["-lc", "echo process-started && sleep 1 && echo process-finished"],
  });

  for await (const event of proc.stream()) {
    if (event.type === "stdout") {
      process.stdout.write(event.data);
    }
  }

  const terminal = await sandbox.terminal.create({
    command: "bash",
    cols: 120,
    rows: 30,
  });

  const connection = await terminal.attach();
  await connection.write("echo terminal-ok\n");

  for await (const event of connection.events()) {
    if (event.type === "output" && event.data.includes("terminal-ok")) {
      break;
    }
  }

  await connection.close();

  const snapshot = await sandbox.createMemorySnapshot();
  console.log(snapshot.snapshotId);

  await sandbox.stop();
};

main().catch(console.error);
```

Reconnect an existing sandbox:

```typescript
const sandbox = await client.sandboxes.connect("sandbox-id");
await sandbox.files.readText("/tmp/hello.txt");
await sandbox.stop();
```

`connect()` refreshes runtime auth and throws if the sandbox is no longer running.
