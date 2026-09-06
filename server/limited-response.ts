export function resolvePositiveIntegerEnv(name: string, fallback: number) {
  const requested = Number(process.env[name] || fallback);
  return Number.isInteger(requested) && requested > 0 ? requested : fallback;
}

export async function readLimitedResponseBody(
  response: {
    headers: { get(name: string): string | null };
    body?: ReadableStream<Uint8Array> | null;
    arrayBuffer(): Promise<ArrayBuffer>;
  },
  maxBytes: number,
) {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`Response exceeds ${maxBytes} bytes`);
  }

  // Fast path: known content-length or no streaming body → single arrayBuffer read
  if (Number.isFinite(contentLength) || !response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      throw new Error(`Response exceeds ${maxBytes} bytes`);
    }
    return bytes;
  }

  // Streaming path: unknown content-length → read chunks with early abort
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error(`Response exceeds ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
