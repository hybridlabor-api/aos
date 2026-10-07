#!/usr/bin/env node
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const WebSocket = require('ws');
const crypto = require('crypto');
const { resolveWsPort, DEFAULT_WS_PORT } = require('./port.js');

if (require.main === module) {
    resolveWsPort(process.env.AOS_UXP_PORT, (WS_PORT) => {
        startServer(WS_PORT);
    });
}

function startServer(WS_PORT) {
    if (WS_PORT !== DEFAULT_WS_PORT) {
        process.stderr.write(`[adobe_uxp_mcp] WebSocket listening on 127.0.0.1:${WS_PORT}\n`);
    }
const wss = new WebSocket.Server({ port: WS_PORT });

// Connected UXP Clients
const clients = new Map();
const pendingRequests = new Map();

wss.on('connection', (ws) => {
    let clientApp = "unknown";
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'register') {
                clientApp = data.app;
                clients.set(clientApp, ws);
                // console.error(`[UXP Bridge] Registered Adobe App: ${clientApp}`);
            } 
            else if (data.status) {
                // It's a response to a tool call
                const pending = pendingRequests.get(data.id);
                if (pending) {
                    if (data.status === 'success') {
                        pending.resolve(data.data);
                    } else {
                        pending.reject(new Error(data.error || "Unknown UXP Error"));
                    }
                    pendingRequests.delete(data.id);
                }
            }
        } catch (e) {
            // console.error("[UXP Bridge] Failed to parse WebSocket message", e);
        }
    });

    ws.on('close', () => {
        if (clients.get(clientApp) === ws) {
            clients.delete(clientApp);
        }
    });
});

async function executeInUXP(app, tool, args) {
    const ws = clients.get(app);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        throw new Error(`Adobe Application '${app}' is not connected to the UXP MCP Bridge.`);
    }

    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            pendingRequests.delete(id);
            reject(new Error("Timeout waiting for UXP response"));
        }, 15000);

        pendingRequests.set(id, {
            resolve: (val) => { clearTimeout(timeout); resolve(val); },
            reject: (err) => { clearTimeout(timeout); reject(err); }
        });

        ws.send(JSON.stringify({
            id,
            type: "execute_tool",
            tool,
            args
        }));
    });
}

const server = new Server({
    name: "adobe-uxp-mcp",
    version: "1.0.0"
}, {
    capabilities: { tools: {} }
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "ps_get_active_document",
                description: "Get the name of the active document in Photoshop.",
                inputSchema: { type: "object", properties: {}, required: [] }
            },
            {
                name: "ps_add_layer",
                description: "Create a new layer in Photoshop.",
                inputSchema: {
                    type: "object",
                    properties: { name: { type: "string" } },
                    required: ["name"]
                }
            },
            {
                name: "pr_get_active_sequence",
                description: "Get the active sequence name in Premiere Pro.",
                inputSchema: { type: "object", properties: {}, required: [] }
            }
        ]
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
        let result = null;
        if (request.params.name.startsWith("ps_")) {
            result = await executeInUXP("photoshop", request.params.name, request.params.arguments);
        } else if (request.params.name.startsWith("pr_")) {
            result = await executeInUXP("premiere", request.params.name, request.params.arguments);
        } else {
            throw new Error(`Unknown tool: ${request.params.name}`);
        }
        
        return {
            content: [{ type: "text", text: String(result) }]
        };
    } catch (error) {
        return {
            isError: true,
            content: [{ type: "text", text: `UXP Error: ${error.message}` }]
        };
    }
});

const transport = new StdioServerTransport();
server.connect(transport).catch(console.error);
}
