const { app, core } = require("photoshop");

// Configure your per-install token here (matches AOS_UXP_TOKEN on the server)
const TOKEN = "YOUR_TOKEN_HERE";
const WS_URL = `ws://127.0.0.1:8080?token=${TOKEN}`;
let socket = new WebSocket(WS_URL);

socket.onopen = () => {
    console.log("UXP connected to MCP Proxy");
    socket.send(JSON.stringify({ type: "register", app: "photoshop" }));
};

socket.onmessage = async (event) => {
    const message = JSON.parse(event.data);
    
    if (message.type === "execute_tool") {
        try {
            let result = null;
            
            if (message.tool === "ps_get_active_document") {
                result = app.activeDocument ? app.activeDocument.name : "No active document";
            } else if (message.tool === "ps_add_layer") {
                await core.executeAsModal(async () => {
                    const newLayer = await app.activeDocument.createArtLayer();
                    newLayer.name = message.args.name || "AI Generated Layer";
                    result = `Layer '${newLayer.name}' created.`;
                }, { commandName: "Create Layer via MCP" });
            }
            
            socket.send(JSON.stringify({
                id: message.id,
                status: "success",
                data: result
            }));
        } catch (err) {
            socket.send(JSON.stringify({
                id: message.id,
                status: "error",
                error: err.toString()
            }));
        }
    }
};

socket.onclose = () => {
    console.log("Disconnected. Reconnecting in 5s...");
    setTimeout(() => { 
        socket = new WebSocket(WS_URL);
    }, 5000);
};
