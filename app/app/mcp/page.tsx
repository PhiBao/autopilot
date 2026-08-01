"use client";

import { useEffect, useMemo, useState } from "react";
import { Header } from "@/components/Header";
import { DEMO_XRPL } from "@/lib/client";

type ToolDef = {
  name: string;
  description: string;
  inputSchema: { properties: Record<string, { type: string; description?: string }>; required?: string[] };
};

const ENDPOINT = "/api/mcp";

function rpc(method: string, params?: Record<string, unknown>) {
  return fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params !== undefined ? { params } : {}) }),
  }).then((r) => r.json());
}

export default function McpPage() {
  const [tools, setTools] = useState<ToolDef[]>([]);
  const [toolName, setToolName] = useState("get_positions");
  const [args, setArgs] = useState<Record<string, string>>({ xrpl: DEMO_XRPL });
  const [output, setOutput] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    rpc("initialize").then(() => rpc("tools/list")).then((res) => {
      setTools((res?.result?.tools ?? []) as ToolDef[]);
      if ((res?.result?.tools ?? []).length > 0) {
        setToolName((res.result.tools[0] as ToolDef).name);
      }
    });
  }, []);

  const tool = useMemo(() => tools.find((t) => t.name === toolName), [tools, toolName]);
  const propNames = useMemo(
    () => (tool ? Object.keys(tool.inputSchema.properties ?? {}) : []),
    [tool]
  );

  async function run() {
    setBusy(true);
    setOutput("calling…");
    try {
      const cleanArgs: Record<string, unknown> = {};
      for (const k of Object.keys(args)) {
        const val = args[k];
        if (val === "") continue;
        const schema = tool?.inputSchema.properties?.[k];
        cleanArgs[k] = schema?.type === "boolean" ? val === "true" : val;
      }
      const res = await rpc("tools/call", { name: toolName, arguments: cleanArgs });
      setOutput(JSON.stringify(res, null, 2));
    } catch (e) {
      setOutput(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  const claudeConfig = `{
  "mcpServers": {
    "autopilot": {
      "type": "http",
      "url": "http://localhost:3000${ENDPOINT}"
    }
  }
}`;

  const curlExample = `curl -s http://localhost:3000${ENDPOINT} \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_positions","arguments":{"xrpl":"${DEMO_XRPL}"}}}'`;

  return (
    <div className="flex-1">
      <Header xrpl={DEMO_XRPL || "mcp"} />
      <main className="max-w-5xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold tracking-tight">Autopilot MCP</h1>
        <p className="muted mt-2 max-w-3xl">
          Let an AI agent manage XRP savings on Flare. This server exposes the same
          deposit / exit / executor engine as a{" "}
          <span className="text-[--text]">Model Context Protocol</span> endpoint — try the tools
          below directly, or wire it into Claude Desktop / Cursor.
        </p>

        <div className="card mt-6">
          <div className="text-xs muted mb-1">Endpoint</div>
          <div className="mono text-sm flex items-center justify-between gap-2">
            <span>POST {ENDPOINT} (JSON-RPC 2.0)</span>
            <span className="badge badge-done">live</span>
          </div>
          <div className="text-xs faint mt-2">
            Methods: <span className="mono">initialize</span> · <span className="mono">tools/list</span> ·{" "}
            <span className="mono">tools/call</span> · <span className="mono">ping</span>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-6 mt-6">
          {/* Tool console */}
          <div className="card">
            <h2 className="font-semibold mb-3">Try a tool</h2>
            <label className="block text-xs muted mb-1">Tool</label>
            <select
              className="input mb-3"
              value={toolName}
              onChange={(e) => {
                setToolName(e.target.value);
                const t = tools.find((x) => x.name === e.target.value);
                const first = Object.keys(t?.inputSchema.properties ?? {})[0];
                setArgs(first ? { [first]: first === "xrpl" ? DEMO_XRPL : "" } : {});
              }}
            >
              {tools.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>

            {tool && (
              <p className="text-xs muted mb-3 leading-relaxed">{tool.description}</p>
            )}

            {propNames.map((name) => {
              const schema = tool?.inputSchema.properties?.[name];
              const isBool = schema?.type === "boolean";
              return (
                <div key={name} className="mb-2">
                  <label className="block text-xs faint mb-1 mono">{name}</label>
                  {isBool ? (
                    <select
                      className="input"
                      value={args[name] ?? "false"}
                      onChange={(e) => setArgs((a) => ({ ...a, [name]: e.target.value }))}
                    >
                      <option value="false">false</option>
                      <option value="true">true</option>
                    </select>
                  ) : (
                    <input
                      className="input mono"
                      placeholder={schema?.description ?? name}
                      value={args[name] ?? ""}
                      onChange={(e) => setArgs((a) => ({ ...a, [name]: e.target.value }))}
                    />
                  )}
                </div>
              );
            })}

            <button className="btn btn-primary w-full mt-3" disabled={busy} onClick={run}>
              {busy ? "Calling…" : "Call tool"}
            </button>
          </div>

          {/* Response */}
          <div>
            <h2 className="font-semibold mb-3">Response</h2>
            <pre className="card bg-[--bg] overflow-auto text-xs mono leading-relaxed max-h-[420px]">
              {output || "Select a tool and press 'Call tool'."}
            </pre>
          </div>
        </div>

        {/* Client config */}
        <div className="mt-8 space-y-6">
          <div>
            <h2 className="font-semibold mb-2">Connect from Claude Desktop</h2>
            <pre className="card bg-[--bg] overflow-auto text-xs mono p-4">{claudeConfig}</pre>
          </div>
          <div>
            <h2 className="font-semibold mb-2">Or with curl</h2>
            <pre className="card bg-[--bg] overflow-auto text-xs mono p-4">{curlExample}</pre>
          </div>
        </div>
      </main>
    </div>
  );
}
