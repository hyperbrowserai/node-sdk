import { createHash } from "crypto";
import { createWriteStream } from "fs";
import { once } from "events";
import { createDeflateRaw } from "zlib";
import { PaxTarWriter } from "./tar";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

const updateCrc32 = (crc: number, chunk: Buffer): number => {
  let value = ~crc >>> 0;
  for (const byte of chunk) {
    value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return ~value >>> 0;
};

/** gzip member header matching CPython `GzipFile(filename="", mtime=0)` at compresslevel 1. */
const GZIP_HEADER = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0x00, 0xff]);

export interface GzipTarResult {
  sizeBytes: number;
  sha256Hex: string;
  uncompressedSizeBytes: number;
}

/**
 * Write a deterministic gzip-compressed tar archive to `path`. The `populate`
 * callback adds entries through the supplied writer.
 */
export const writeGzipTar = async (
  path: string,
  populate: (writer: PaxTarWriter) => Promise<void>
): Promise<GzipTarResult> => {
  const output = createWriteStream(path, { flags: "wx" });
  // Observe write errors immediately, including failures before the first drain.
  let outputError: Error | undefined;
  output.on("error", (error) => { outputError = error; deflate.destroy(error); });
  const hasher = createHash("sha256");
  let compressedSize = 0;
  let crc = 0;
  let uncompressedSize = 0;

  const writeOutput = async (chunk: Buffer): Promise<void> => {
    if (outputError) throw outputError;
    hasher.update(chunk);
    compressedSize += chunk.length;
    if (!output.write(chunk)) {
      await once(output, "drain");
    }
  };

  const deflate = createDeflateRaw({ level: 1 });
  const drainDeflate = (async () => {
    for await (const chunk of deflate) {
      await writeOutput(chunk as Buffer);
    }
  })();
  // A source failure can occur while compression is still draining.
  void drainDeflate.catch(() => undefined);

  try {
    await writeOutput(GZIP_HEADER);
    const writer = new PaxTarWriter(async (chunk) => {
      crc = updateCrc32(crc, chunk);
      uncompressedSize += chunk.length;
      if (!deflate.write(chunk)) {
        await once(deflate, "drain");
      }
    });
    await populate(writer);
    await writer.close();
    deflate.end();
    await drainDeflate;
    const trailer = Buffer.alloc(8);
    trailer.writeUInt32LE(crc >>> 0, 0);
    trailer.writeUInt32LE(uncompressedSize % 2 ** 32, 4);
    await writeOutput(trailer);
    output.end();
    await once(output, "finish");
  } catch (error) {
    deflate.destroy();
    output.destroy();
    await drainDeflate.catch(() => undefined);
    throw error;
  }

  return {
    sizeBytes: compressedSize,
    sha256Hex: hasher.digest("hex"),
    uncompressedSizeBytes: uncompressedSize,
  };
};
