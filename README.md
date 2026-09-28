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
    cpu: 4,
    memoryMiB: 4096,
    diskMiB: 8192,
  });

  // Provide exactly one launch source:
  // snapshotName or imageName.
  // snapshotId requires snapshotName and imageId requires imageName.
  // cpu, memoryMiB, and diskMiB are only available for image launches.

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

  const proc = await sandbox.processes.start(
    "echo process-started && sleep 1 && echo process-finished",
    {
      runAs: "root",
    }
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

Run commands and stream complete output. `exec()` and `processes.start()` open a
single streamed request and collect stdout/stderr from process start, so output is
complete even beyond the receiver's replay window. `wait()` timeouts are local and
keep collecting; `disconnect()` stops collecting without killing the process.

```typescript
const result = await sandbox.exec("npm test", {
  cwd: "/workspace",
  maxOutputBytes: 128 * 1024 * 1024, // default 64 MiB; exceeding it fails, never truncates
});
console.log(result.exitCode, result.stdout);

const proc = await sandbox.processes.start("tail -f /var/log/app.log");
try {
  await proc.wait({ timeoutSec: 5 });
} catch (error) {
  // Local wait timeout: the process is still running and output is still collected.
}
for await (const event of proc.stream()) {
  if (event.type === "stdout") process.stdout.write(event.data);
  if (event.type === "exit") console.log(event.result.exitCode);
}
proc.disconnect();
```

Build a custom sandbox image from a Dockerfile or a local Docker image. `getOrBuildImage()`
derives a content-based image name, reuses a ready image with the same identity, joins a
matching in-progress build, or creates a new one. Dockerfile builds package the effective
build context (Dockerfile sources, `.dockerignore`) and build remotely; no local Docker is
required. `dockerImage` imports a local `linux/amd64` image via the Docker CLI.

```typescript
const resolved = await client.sandboxes.getOrBuildImage({
  contextPath: "./services/api",
  dockerfile: "Dockerfile", // relative to contextPath
  imageInit: { env: { NODE_ENV: "production" }, workingDir: "/app" },
  builderCpus: 4,
  builderMemoryMiB: 8192,
  builderScratchMiB: 20480,
});
console.log(resolved.outcome, resolved.imageName, resolved.imageId); // "reused" | "joined" | "created"

const sandbox = await client.sandboxes.create({ imageName: resolved.imageName });

// Import a local Docker image instead (requires docker CLI, linux/amd64 image):
const imported = await client.sandboxes.getOrBuildImage({ dockerImage: "myorg/app:1.2.3" });

// Detached build: return immediately and poll later.
const pending = await client.sandboxes.getOrBuildImage({ contextPath: ".", wait: false });
if (pending.build) {
  const build = await client.sandboxes.waitForImageBuild(pending.build.id, {
    pollInterval: 3,
    timeout: 35 * 60,
  });
  console.log(build.status, build.imageId);
}
```

Lower-level helpers are also available: `buildImageFromDockerfile()`,
`buildImageFromDockerImage()`, `findReadyImage()`, `reuseDockerImage()`, plus the raw
`createImageBuild()` / `completeImageBuild()` / `getImageBuild()` / `listImageBuilds()` /
`cancelImageBuild()` APIs. Control-plane `GET` requests retry transient failures
(429/502/503/504 and network errors) up to three times with jittered backoff.

Create a sandbox with pre-exposed ports:

```typescript
const sandbox = await client.sandboxes.create({
  imageName: "node",
  cpu: 2,
  memoryMiB: 2048,
  diskMiB: 8192,
  exposedPorts: [{ port: 3000, auth: true }],
});

console.log(sandbox.exposedPorts[0].browserUrl);
```

Manage volumes and mount them into a sandbox:

```typescript
const volume = await client.volumes.create({ name: "project-cache" });
const volumes = await client.volumes.list();
const sameVolume = await client.volumes.get(volume.id);

const sandbox = await client.sandboxes.create({
  imageName: "node",
  mounts: {
    "/workspace/cache": {
      id: sameVolume.id,
      type: "rw",
      shared: true,
    },
  },
});

await sandbox.stop();
await client.volumes.delete(sameVolume.id);
```

List sandboxes with time-range and search filters:

```typescript
const sandboxes = await client.sandboxes.list({
  status: "active",
  start: Date.now() - 60 * 60 * 1000,
  end: Date.now(),
  search: "sbx_",
  limit: 25,
});
```

List snapshots for a specific image:

```typescript
const snapshots = await client.sandboxes.listSnapshots({
  imageName: "node",
  status: "created",
  limit: 10,
});
```

Expose and unexpose ports:

```typescript
const sandbox = await client.sandboxes.create({ imageName: "node" });

const exposure = await sandbox.expose({ port: 8080, auth: true });
console.log(exposure.url, exposure.browserUrl, exposure.browserUrlExpiresAt);

await sandbox.unexpose(8080);
```

Write batch files with per-entry options:

```typescript
await sandbox.files.write([
  {
    path: "/tmp/hello.txt",
    data: "hello",
    append: true,
    mode: "600",
  },
  {
    path: "/tmp/payload.bin",
    data: Buffer.from([1, 2, 3]).toString("base64"),
    encoding: "base64",
  },
]);
```

Resume a PTY attach from a cursor:

```typescript
const terminal = await sandbox.terminal.create({
  command: "bash",
  rows: 24,
  cols: 80,
});

const connection = await terminal.attach(10);
```
