/** JSON.stringify replacer that converts BigInt to string. */
export function bigIntReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

/** BigInt-safe JSON response. Builds the body directly to avoid NextResponse.json's internal serializer. */
export function json(data: unknown, init?: ResponseInit): Response {
  const body = JSON.stringify(data, bigIntReplacer);
  return new Response(body, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
}
