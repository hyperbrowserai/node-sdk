import { RequestInit } from "node-fetch";

export type RequestInitFactory = () => RequestInit | Promise<RequestInit>;

export async function resolveRequestInit(init: RequestInit | RequestInitFactory): Promise<RequestInit> {
  return typeof init === "function" ? await init() : init;
}

export function isReplayableBody(body: RequestInit["body"]): boolean {
  if (body == null) {
    return true;
  }
  if (typeof body === "string" || Buffer.isBuffer(body) || body instanceof URLSearchParams) {
    return true;
  }
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    return true;
  }
  return false;
}
