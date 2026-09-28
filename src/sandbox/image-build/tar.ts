/**
 * Minimal tar support: a PAX-format writer that mirrors CPython's `tarfile`
 * output for the normalized entries used in build contexts, and a streaming
 * reader for `docker image save` archives.
 */

import type { Readable } from "stream";

const BLOCK_SIZE = 512;
const RECORD_SIZE = BLOCK_SIZE * 20;
const POSIX_MAGIC = Buffer.from("ustar\x0000", "binary");
const NUL = Buffer.alloc(1);

export type TarEntryType = "file" | "directory" | "symlink";

export interface TarEntryInfo {
  /** Archive path; directories carry a trailing slash. */
  name: string;
  type: TarEntryType;
  mode: number;
  size: number;
  linkname: string;
}

const TYPE_FLAGS: Record<TarEntryType, string> = {
  file: "0",
  directory: "5",
  symlink: "2",
};

// Tar header validation intentionally includes NUL.
// eslint-disable-next-line no-control-regex
const isAscii = (value: string): boolean => /^[\x00-\x7f]*$/.test(value);

/** Python `stn`: encode with ASCII "replace" errors, then NUL-pad or truncate. */
const stringField = (value: string, length: number): Buffer => {
  // eslint-disable-next-line no-control-regex
  const encoded = Buffer.from(value.replace(/[^\x00-\x7f]/g, "?"), "latin1");
  const field = Buffer.alloc(length);
  encoded.copy(field, 0, 0, Math.min(encoded.length, length));
  return field;
};

/** Python `itn` for values that fit the octal field. */
const numberField = (value: number, digits: number): Buffer => {
  if (value < 0 || value >= 8 ** (digits - 1)) {
    throw new RangeError(`tar header value ${value} does not fit in ${digits} digits`);
  }
  return Buffer.concat([Buffer.from(value.toString(8).padStart(digits - 1, "0"), "ascii"), NUL]);
};

interface HeaderFields {
  name: string;
  mode?: number;
  size: number;
  type: string;
  linkname?: string;
}

const createHeader = (fields: HeaderFields): Buffer => {
  const parts = [
    stringField(fields.name, 100),
    numberField((fields.mode ?? 0) & 0o7777, 8),
    numberField(0, 8),
    numberField(0, 8),
    numberField(fields.size, 12),
    numberField(0, 12),
    Buffer.from("        ", "ascii"),
    Buffer.from(fields.type, "ascii"),
    stringField(fields.linkname ?? "", 100),
    POSIX_MAGIC,
    stringField("", 32),
    stringField("", 32),
    numberField(0, 8),
    numberField(0, 8),
    stringField("", 155),
  ];
  const header = Buffer.alloc(BLOCK_SIZE);
  Buffer.concat(parts).copy(header);
  let checksum = 0;
  for (const byte of header) {
    checksum += byte;
  }
  Buffer.from(checksum.toString(8).padStart(6, "0") + "\0 ", "ascii").copy(header, 148);
  return header;
};

const padToBlock = (size: number): Buffer => {
  const remainder = size % BLOCK_SIZE;
  return remainder === 0 ? Buffer.alloc(0) : Buffer.alloc(BLOCK_SIZE - remainder);
};

const createPaxHeader = (records: Array<[string, string]>): Buffer => {
  const encodedRecords: Buffer[] = [];
  for (const [keyword, value] of records) {
    const key = Buffer.from(keyword, "utf8");
    const data = Buffer.from(value, "utf8");
    const base = key.length + data.length + 3;
    let n = 0;
    let p = 0;
    while (true) {
      n = base + String(p).length;
      if (n === p) {
        break;
      }
      p = n;
    }
    encodedRecords.push(Buffer.from(`${p} `, "ascii"), key, Buffer.from("=", "ascii"), data);
    encodedRecords.push(Buffer.from("\n", "ascii"));
  }
  const payload = Buffer.concat(encodedRecords);
  return Buffer.concat([
    createHeader({ name: "././@PaxHeader", size: payload.length, type: "x" }),
    payload,
    padToBlock(payload.length),
  ]);
};

export const createTarEntryHeader = (info: TarEntryInfo): Buffer => {
  const pax: Array<[string, string]> = [];
  if (!isAscii(info.name) || info.name.length > 100) {
    pax.push(["path", info.name]);
  }
  if (!isAscii(info.linkname) || info.linkname.length > 100) {
    pax.push(["linkpath", info.linkname]);
  }
  let size = info.size;
  if (size < 0 || size >= 8 ** 11) {
    pax.push(["size", String(info.size)]);
    size = 0;
  }
  const header = createHeader({
    name: info.name,
    mode: info.mode,
    size,
    type: TYPE_FLAGS[info.type],
    linkname: info.linkname,
  });
  return pax.length > 0 ? Buffer.concat([createPaxHeader(pax), header]) : header;
};

export type TarSink = (chunk: Buffer) => Promise<void>;

/** Sequential PAX tar writer; `close` writes the end-of-archive blocks. */
export class PaxTarWriter {
  private written = 0;

  constructor(private readonly sink: TarSink) {}

  private async emit(chunk: Buffer): Promise<void> {
    if (chunk.length === 0) {
      return;
    }
    this.written += chunk.length;
    await this.sink(chunk);
  }

  async addEntry(info: TarEntryInfo, content?: AsyncIterable<Buffer>): Promise<void> {
    await this.emit(createTarEntryHeader(info));
    if (info.type !== "file") {
      return;
    }
    let copied = 0;
    if (content) {
      for await (const chunk of content) {
        copied += chunk.length;
        if (copied > info.size) {
          throw new Error(`tar entry "${info.name}" produced more data than its declared size`);
        }
        await this.emit(chunk);
      }
    }
    if (copied !== info.size) {
      throw new Error(`tar entry "${info.name}" was truncated`);
    }
    await this.emit(padToBlock(info.size));
  }

  async close(): Promise<void> {
    await this.emit(Buffer.alloc(BLOCK_SIZE * 2));
    const remainder = this.written % RECORD_SIZE;
    if (remainder !== 0) {
      await this.emit(Buffer.alloc(RECORD_SIZE - remainder));
    }
  }
}

class ByteReader {
  private readonly iterator: AsyncIterator<Buffer>;
  private pending: Buffer = Buffer.alloc(0);
  private done = false;

  constructor(source: AsyncIterable<Buffer | string>) {
    const raw = source[Symbol.asyncIterator]();
    this.iterator = {
      next: async () => {
        const result = await raw.next();
        return result.done
          ? { done: true, value: undefined as unknown as Buffer }
          : {
              done: false,
              value: Buffer.isBuffer(result.value) ? result.value : Buffer.from(result.value),
            };
      },
    };
  }

  private async fill(): Promise<boolean> {
    if (this.done) {
      return false;
    }
    const result = await this.iterator.next();
    if (result.done) {
      this.done = true;
      return false;
    }
    this.pending = this.pending.length ? Buffer.concat([this.pending, result.value]) : result.value;
    return true;
  }

  /** Read exactly `length` bytes, or return null at a clean end of stream. */
  async readExact(length: number): Promise<Buffer | null> {
    while (this.pending.length < length) {
      if (!(await this.fill())) {
        if (this.pending.length === 0) {
          return null;
        }
        throw new Error("unexpected end of tar stream");
      }
    }
    const chunk = this.pending.subarray(0, length);
    this.pending = this.pending.subarray(length);
    return chunk;
  }

  async *readChunks(length: number): AsyncGenerator<Buffer> {
    let remaining = length;
    while (remaining > 0) {
      if (this.pending.length === 0 && !(await this.fill())) {
        throw new Error("unexpected end of tar stream");
      }
      const take = Math.min(remaining, this.pending.length);
      const chunk = this.pending.subarray(0, take);
      this.pending = this.pending.subarray(take);
      remaining -= take;
      yield chunk;
    }
  }

  async skip(length: number): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _chunk of this.readChunks(length)) {
      // discard
    }
  }
}

export interface TarStreamEntry {
  name: string;
  size: number;
  typeflag: string;
  mode: number;
  linkname: string;
  isFile: boolean;
  /** Stream the entry contents. Must be consumed before advancing. */
  content(): AsyncGenerator<Buffer>;
}

const parseOctal = (field: Buffer): number => {
  if (field.length > 0 && field[0] & 0x80) {
    let value = 0n;
    for (let index = 0; index < field.length; index += 1) {
      value = (value << 8n) | BigInt(index === 0 ? field[0] & 0x7f : field[index]);
    }
    return Number(value);
  }
  const text = field.toString("ascii").replace(/\0.*$/s, "").trim();
  if (text === "") {
    return 0;
  }
  if (!/^[0-7]+$/.test(text)) {
    throw new Error("invalid tar header number field");
  }
  return parseInt(text, 8);
};

const parseString = (field: Buffer): string => {
  const end = field.indexOf(0);
  return (end === -1 ? field : field.subarray(0, end)).toString("utf8");
};

const parsePaxRecords = (payload: Buffer): Map<string, string> => {
  const records = new Map<string, string>();
  let offset = 0;
  while (offset < payload.length) {
    const space = payload.indexOf(0x20, offset);
    if (space === -1) {
      throw new Error("invalid PAX header record");
    }
    const length = parseInt(payload.subarray(offset, space).toString("ascii"), 10);
    if (!Number.isInteger(length) || length <= 0 || offset + length > payload.length) {
      throw new Error("invalid PAX header record");
    }
    const record = payload.subarray(space + 1, offset + length - 1).toString("utf8");
    const separator = record.indexOf("=");
    if (separator === -1) {
      throw new Error("invalid PAX header record");
    }
    records.set(record.slice(0, separator), record.slice(separator + 1));
    offset += length;
  }
  return records;
};

/**
 * Iterate over tar entries from a stream. Callers must fully consume an
 * entry's content before advancing; unread content is skipped.
 */
export async function* readTarEntries(source: Readable): AsyncGenerator<TarStreamEntry> {
  const reader = new ByteReader(source);
  const globalPax = new Map<string, string>();
  let paxOverrides: Map<string, string> | null = null;
  let gnuLongName: string | null = null;
  let gnuLongLink: string | null = null;

  while (true) {
    const header = await reader.readExact(BLOCK_SIZE);
    if (header === null || header.every((byte) => byte === 0)) {
      return;
    }
    const typeflag = header.subarray(156, 157).toString("ascii");
    const size = parseOctal(header.subarray(124, 136));
    if (!Number.isSafeInteger(size) || size < 0) throw new Error("invalid tar entry size");
    if (["x", "g", "L", "K"].includes(typeflag) && size > 16 * 1024 * 1024) throw new Error("tar metadata exceeds the size limit");
    const padded = size + (BLOCK_SIZE - (size % BLOCK_SIZE || BLOCK_SIZE));

    if (typeflag === "x" || typeflag === "g") {
      const payload = await reader.readExact(padded);
      if (payload === null) {
        throw new Error("unexpected end of tar stream");
      }
      if (typeflag === "x") {
        paxOverrides = parsePaxRecords(payload.subarray(0, size));
      } else {
        for (const [key, value] of parsePaxRecords(payload.subarray(0, size))) {
          if (value) globalPax.set(key, value); else globalPax.delete(key);
        }
      }
      continue;
    }
    if (typeflag === "L" || typeflag === "K") {
      const payload = await reader.readExact(padded);
      if (payload === null) {
        throw new Error("unexpected end of tar stream");
      }
      const value = parseString(payload.subarray(0, size));
      if (typeflag === "L") {
        gnuLongName = value;
      } else {
        gnuLongLink = value;
      }
      continue;
    }

    let name = parseString(header.subarray(0, 100));
    const magic = header.subarray(257, 263).toString("binary");
    const prefix = parseString(header.subarray(345, 500));
    if (magic.startsWith("ustar") && prefix && typeflag !== "L") {
      name = `${prefix}/${name}`;
    }
    if (gnuLongName !== null) {
      name = gnuLongName;
    }
    let linkname = parseString(header.subarray(157, 257));
    if (gnuLongLink !== null) {
      linkname = gnuLongLink;
    }
    const mode = parseOctal(header.subarray(100, 108)) & 0o7777;
    let entrySize = size;
    paxOverrides = new Map([...globalPax, ...(paxOverrides ?? [])]);
    if (paxOverrides) {
      const path = paxOverrides.get("path");
      if (path !== undefined) {
        name = path;
      }
      const linkpath = paxOverrides.get("linkpath");
      if (linkpath !== undefined) {
        linkname = linkpath;
      }
      const paxSize = paxOverrides.get("size");
      if (paxSize !== undefined) {
        entrySize = Number(paxSize);
        if (!Number.isSafeInteger(entrySize) || entrySize < 0) {
          throw new Error("invalid PAX size record");
        }
      }
    }
    paxOverrides = null;
    gnuLongName = null;
    gnuLongLink = null;

    let remaining = entrySize;
    const content = async function* (): AsyncGenerator<Buffer> {
      const total = remaining;
      remaining = 0;
      yield* reader.readChunks(total);
    };
    yield {
      name,
      size: entrySize,
      typeflag,
      mode,
      linkname,
      isFile: typeflag === "0" || typeflag === "\0" || typeflag === "7",
      content,
    };
    if (remaining > 0) {
      await reader.skip(remaining);
      remaining = 0;
    }
    const padding = entrySize % BLOCK_SIZE === 0 ? 0 : BLOCK_SIZE - (entrySize % BLOCK_SIZE);
    if (padding > 0) {
      await reader.skip(padding);
    }
  }
}
