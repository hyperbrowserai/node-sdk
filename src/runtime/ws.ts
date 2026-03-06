export class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<{
    resolve: (value: IteratorResult<T>) => void;
    reject: (reason?: unknown) => void;
  }> = [];
  private done = false;
  private error: unknown = null;

  push(value: T) {
    if (this.done) {
      return;
    }

    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve({ value, done: false });
      return;
    }

    this.values.push(value);
  }

  close() {
    if (this.done) {
      return;
    }

    this.done = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()?.resolve({ value: undefined, done: true });
    }
  }

  fail(error: unknown) {
    if (this.done) {
      return;
    }

    this.done = true;
    this.error = error;
    while (this.waiters.length > 0) {
      this.waiters.shift()?.reject(error);
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.values.length > 0) {
          return Promise.resolve({
            value: this.values.shift() as T,
            done: false,
          });
        }

        if (this.done) {
          if (this.error) {
            return Promise.reject(this.error);
          }

          return Promise.resolve({ value: undefined, done: true });
        }

        return new Promise<IteratorResult<T>>((resolve, reject) => {
          this.waiters.push({ resolve, reject });
        });
      },
    };
  }
}

export interface RuntimeTransportTarget {
  url: string;
  hostHeader?: string;
}

const REGIONAL_PROXY_DEV_HOST = process.env.REGIONAL_PROXY_DEV_HOST?.trim();

const hasScheme = (value: string): boolean => /^[a-z][a-z0-9+.-]*:\/\//i.test(value);

export const resolveRuntimeTransportTarget = (
  baseUrl: string,
  path: string
): RuntimeTransportTarget => {
  const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);

  if (!REGIONAL_PROXY_DEV_HOST) {
    return {
      url: url.toString(),
    };
  }

  const override = new URL(
    hasScheme(REGIONAL_PROXY_DEV_HOST)
      ? REGIONAL_PROXY_DEV_HOST
      : `${url.protocol}//${REGIONAL_PROXY_DEV_HOST}`
  );

  url.protocol = override.protocol;
  url.username = override.username;
  url.password = override.password;
  url.hostname = override.hostname;
  url.port = override.port || url.port;

  return {
    url: url.toString(),
    hostHeader: new URL(baseUrl).host,
  };
};

export const toWebSocketUrl = (
  baseUrl: string,
  path: string
): RuntimeTransportTarget => {
  const target = resolveRuntimeTransportTarget(baseUrl, path);
  const url = new URL(target.url);
  if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else if (url.protocol === "http:") {
    url.protocol = "ws:";
  }
  return {
    url: url.toString(),
    hostHeader: target.hostHeader,
  };
};
