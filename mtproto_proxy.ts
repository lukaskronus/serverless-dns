// mtproto_proxy.ts
import { serve } from "https://deno.land/std@0.200.0/http/server.ts";

// Configuration
const CONFIG = {
  SECRET: Deno.env.get("MT_PROTO_SECRET") || generateSecret(),
  PORT: parseInt(Deno.env.get("PORT") || "8000"),
  DC_IP: Deno.env.get("DC_IP") || "149.154.167.91", // Telegram DC IP
  DC_PORT: parseInt(Deno.env.get("DC_PORT") || "443"),
};

// Generate a random secret if none provided
function generateSecret(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Handle WebSocket connections
async function handleWs(socket: WebSocket) {
  let telegramSocket: WebSocket | null = null;
  
  try {
    telegramSocket = new WebSocket(`wss://${CONFIG.DC_IP}:${CONFIG.DC_PORT}/api`);
    
    telegramSocket.onopen = () => console.log("Connected to Telegram DC");
    telegramSocket.onmessage = (e) => socket.send(e.data);
    telegramSocket.onclose = () => socket.close();
    
    socket.onmessage = (e) => telegramSocket?.send(e.data);
    socket.onclose = () => telegramSocket?.close();
    
  } catch (err) {
    console.error("WebSocket error:", err);
    socket.close();
    telegramSocket?.close();
  }
}

// HTTP request handler
function handleRequest(req: Request): Response {
  const url = new URL(req.url);
  
  // WebSocket endpoint for MTProto
  if (url.pathname === "/proxy" && req.headers.get("upgrade") === "websocket") {
    const { socket, response } = Deno.upgradeWebSocket(req);
    handleWs(socket);
    return response;
  }
  
  // Proxy info for Telegram client
  if (url.pathname === "/proxy_info") {
    return Response.json({
      server: url.hostname,
      port: 443, // Deno Deploy uses 443 for HTTPS
      secret: CONFIG.SECRET,
    });
  }
  
  // Simple homepage
  return new Response(`
Telegram MTProto Proxy (Deno Deploy)

Secret: ${CONFIG.SECRET}

Add this proxy to Telegram:
1. Go to Settings > Data and Storage > Proxy
2. Add proxy: MTProto
3. Server: ${url.hostname}
4. Port: 443
5. Secret: ${CONFIG.SECRET}
6. Save and connect
`.trim());
}

// Start server
console.log(`MTProto Proxy running on port ${CONFIG.PORT}`);
serve(handleRequest, { port: CONFIG.PORT });
