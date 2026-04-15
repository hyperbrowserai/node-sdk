import { promises as fs } from "fs";
import * as path from "path";
import { ControlAuthError } from "./control-auth-errors";

export type LockHandle = Awaited<ReturnType<typeof fs.open>>;

export async function tryAcquireRotationLock(lockPath: string): Promise<LockHandle | null> {
  await fs.mkdir(path.dirname(lockPath), {
    recursive: true,
    mode: 0o700,
  });
  await fs.chmod(path.dirname(lockPath), 0o700).catch(() => undefined);

  let handle: LockHandle | undefined;
  try {
    handle = await fs.open(lockPath, "wx", 0o600);
    await handle.writeFile(`pid=${process.pid}\ncreated_at=${new Date().toISOString()}\n`, "utf8");
    await handle.sync();
    return handle;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return null;
    }
    await handle?.close().catch(() => undefined);
    if (handle) {
      await fs
        .rm(lockPath, {
          force: true,
        })
        .catch(() => undefined);
    }
    throw new ControlAuthError("Failed to create OAuth rotation lock", {
      code: "auth_rotation_lock_failed",
      retryable: false,
      cause: error,
    });
  }
}

export async function clearStaleRotationLock(
  lockPath: string,
  lockStaleMs: number
): Promise<void> {
  let info;
  try {
    info = await fs.stat(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw new ControlAuthError("Failed to inspect OAuth rotation lock", {
      code: "auth_rotation_lock_failed",
      retryable: false,
      cause: error,
    });
  }

  if (Date.now() - info.mtimeMs < lockStaleMs) {
    return;
  }

  await fs.rm(lockPath, {
    force: true,
  });
}

export async function releaseRotationLock(lockPath: string, handle: LockHandle): Promise<void> {
  await handle.close().catch(() => undefined);
  await fs
    .rm(lockPath, {
      force: true,
    })
    .catch(() => undefined);
}

export async function tryReadSessionMtimeMs(sessionPath: string): Promise<number | null> {
  try {
    return (await fs.stat(sessionPath)).mtimeMs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw new ControlAuthError("Failed to inspect saved OAuth session", {
      code: "oauth_session_read_failed",
      retryable: false,
      cause: error,
    });
  }
}
