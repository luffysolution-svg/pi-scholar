import { open } from "node:fs/promises";

/** Read a response body without allowing a missing/dishonest Content-Length to bypass the limit. */
export async function readResponseBytes(
  response: Response,
  maxBytes = 512 * 1024 * 1024,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Response body exceeds ${Math.floor(maxBytes / 1024 / 1024)} MB limit`);
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const abort = () => { void reader.cancel(signal?.reason).catch(() => undefined); };
  signal?.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("archive size limit exceeded").catch(() => undefined);
        throw new Error(`Response body exceeds ${Math.floor(maxBytes / 1024 / 1024)} MB limit`);
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

/** A fixed-size read avoids loading an arbitrarily large file before enforcing a limit. */
export async function readFileBounded(file: string, maxBytes: number, signal?: AbortSignal): Promise<Buffer> {
  const handle = await open(file, "r");
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maxBytes) throw new Error(`File is not regular or exceeds ${maxBytes} byte limit`);
    const bytes = Buffer.alloc(Math.min(info.size + 1, maxBytes + 1));
    let offset = 0;
    while (offset < bytes.length) {
      signal?.throwIfAborted();
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, null);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset !== info.size || offset > maxBytes) throw new Error("File changed while reading; retry with a stable input");
    return bytes.subarray(0, offset);
  } finally { await handle.close(); }
}
