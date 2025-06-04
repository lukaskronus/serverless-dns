import { serve } from "https://deno.land/std@0.200.0/http/server.ts";
import { crypto } from "https://deno.land/std@0.200.0/crypto/mod.ts";

// Configuration - set these via environment variables
const CONFIG = {
  SECRET: Deno.env.get("MT_PROTO_SECRET") || crypto.randomUUID().replace(/-/g, ""),
  PORT: parseInt(Deno.env.get("PORT") || "9090"),
  TAG: Deno.env.get("PROXY_TAG") || "deno-mtproto-proxy",
  DC_OPTIONS: [
    { id: 1, ip: "149.154.175.50", port: 443 },
    { id: 2, ip: "149.154.167.51", port: 443 },
    { id: 3, ip: "149.154.175.100", port: 443 },
    { id: 4, ip: "149.154.167.91", port: 443 },
    { id: 5, ip: "91.108.56.100", port: 443 },
  ],
};

// MTProto protocol constants
const MT_PROTO_HEADER = 0xefefefef;
const ABRIDGED_VERSION = 0xef;

// Helper to connect to Telegram DC
async function connectToDC(dc: typeof CONFIG.DC_OPTIONS[0]) {
  try {
    const conn = await Deno.connect({
      hostname: dc.ip,
      port: dc.port,
    });
    return conn;
  } catch (err) {
    console.error(`Failed to connect to DC ${dc.id}:`, err);
    return null;
  }
}

// Handle client connections
async function handleConnection(conn: Deno.Conn) {
  const buffer = new Uint8Array(4096);
  const dcConn = await connectToDC(CONFIG.DC_OPTIONS[0]);
  
  if (!dcConn) {
    conn.close();
    return;
  }

  // Pipe data between client and DC
  const pipe = async (src: Deno.Conn, dst: Deno.Conn) => {
    try {
      while (true) {
        const n = await src.read(buffer);
        if (n === null) break;
        await dst.write(buffer.subarray(0, n));
      }
    } catch (err) {
      console.error("Pipe error:", err);
    } finally {
      src.close();
      dst.close();
    }
  };

  // Start bidirectional piping
  pipe(conn, dcConn);
  pipe(dcConn, conn);
}

// HTTP/WebSocket handler
async function handleRequest(req: Request, connInfo: Deno.ServeHandlerInfo) {
  const url = new URL(req.url);

  // WebSocket endpoint for MTProto
  if (url.pathname === "/api" && req.headers.get("upgrade") === "websocket") {
    const { socket, response } = Deno.upgradeWebSocket(req);
    
    socket.onmessage = async (e) => {
      // Handle MTProto messages here
      // In production, you'd decrypt/process messages
      socket.send(e.data);
    };

    return response;
  }

  // Proxy info endpoint
  if (url.pathname === "/proxy_info") {
    return Response.json({
      server: `${url.hostname}`,
      port: CONFIG.PORT,
      secret: CONFIG.SECRET,
      tag: CONFIG.TAG,
      dc_options: CONFIG.DC_OPTIONS,
    });
  }

  // Health check
  if (url.pathname === "/health") {
    return new Response("OK");
  }

  // Default response
  return new Response(`
MTProto Proxy (Deno)
--------------------
Secret: ${CONFIG.SECRET}
Tag: ${CONFIG.TAG}
Port: ${CONFIG.PORT}

Use /proxy_info for client configuration
`.trim(), { headers: { "Content-Type": "text/plain" } });
}

// Start servers
console.log(`Starting MTProto proxy on port ${CONFIG.PORT}`);
console.log(`Proxy secret: ${CONFIG.SECRET}`);

// Start HTTP server
serve(handleRequest, { port: CONFIG.PORT });

// Start raw TCP server for MTProto
Deno.listen({ port: CONFIG.PORT }).then(async (listener) => {
  console.log(`TCP server ready on port ${CONFIG.PORT}`);
  for await (const conn of listener) {
    handleConnection(conn);
  }
});
