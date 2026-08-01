import { handleMcpRequest } from "@/lib/mcp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Autopilot MCP endpoint — Model Context Protocol over HTTP (JSON-RPC 2.0).
 *
 * Methods: initialize, ping, tools/list, tools/call, notifications/initialized.
 * Tools let an AI agent manage XRP savings on Flare: get_positions, get_vaults,
 * create_deposit, create_exit, sign_step, run_executor, get_intents.
 */
export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  if (raw === null) {
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const response = await handleMcpRequest(raw);
  if (response === null) {
    // Notification (e.g. notifications/initialized) — 202 Accepted, no body.
    return new Response(null, { status: 202 });
  }
  return new Response(JSON.stringify(response), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2025-06-18",
    },
  });
}

export async function GET() {
  return new Response(
    JSON.stringify({
      name: "Autopilot MCP",
      version: "1.0.0",
      endpoint: "POST /api/mcp",
      description:
        "Model Context Protocol endpoint for Autopilot — manage XRP savings on Flare. " +
        "Call initialize, tools/list and tools/call with JSON-RPC 2.0.",
      tools: ["get_positions", "get_vaults", "create_deposit", "create_exit", "sign_step", "run_executor", "get_intents"],
      example: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "get_vaults", arguments: {} },
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
