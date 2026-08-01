import { TOOLS, callTool, type McpCallResult } from "./tools";

export const MCP_PROTOCOL_VERSION = "2025-06-18";

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

function ok(id: JsonRpcRequest["id"], result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function err(id: JsonRpcRequest["id"], code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

/**
 * Handle a single MCP JSON-RPC 2.0 message (Streamable HTTP transport subset).
 * Stateless: each request is independent. Supports initialize, ping,
 * tools/list, tools/call and notifications/initialized (a no-op response-less).
 */
export async function handleMcpMessage(body: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const { id, method, params } = body;

  switch (method) {
    case "initialize":
      return ok(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "autopilot", version: "1.0.0" },
      });

    case "ping":
      return ok(id, {});

    case "tools/list":
      return ok(id, { tools: TOOLS });

    case "tools/call": {
      const name = String((params as { name?: string })?.name ?? "");
      const args = ((params as { arguments?: Record<string, unknown> })?.arguments ?? {}) as Record<string, unknown>;
      if (!name) return err(id, -32602, "Missing tool name");
      const result: McpCallResult = await callTool(name, args);
      return ok(id, result);
    }

    case "notifications/initialized":
      // Notifications are response-less; the server acknowledges with no body.
      return null;

    case "resources/list":
      return ok(id, { resources: [] });

    case "prompts/list":
      return ok(id, { prompts: [] });

    default:
      return err(id, -32601, `Method not found: ${method}`);
  }
}

/** Handle a JSON-RPC request that may be a single object or a batch array. */
export async function handleMcpRequest(raw: unknown): Promise<unknown> {
  if (Array.isArray(raw)) {
    const responses = await Promise.all(
      raw.map((item) => handleMcpMessage(item as JsonRpcRequest).catch(() => null))
    );
    return responses.filter((r) => r !== null);
  }
  const result = await handleMcpMessage(raw as JsonRpcRequest).catch((e) =>
    err((raw as JsonRpcRequest)?.id ?? null, -32603, `Internal error: ${(e as Error).message}`)
  );
  return result;
}
