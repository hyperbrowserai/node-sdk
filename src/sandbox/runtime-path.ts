export const runtimeSessionIdFromPath = (rawPath: string): string | null => {
  const segments = rawPath
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean);
  if (segments.length < 2 || segments[0] !== "sandbox" || !segments[1]?.trim()) {
    return null;
  }
  return segments[1].trim();
};

export const runtimeBaseUrlSessionId = (runtimeBaseUrl: string): string | null => {
  return runtimeSessionIdFromPath(new URL(runtimeBaseUrl).pathname);
};
