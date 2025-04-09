// src/handleOptions.ts
export const handleOptions = (request: Request): Response => {
  const origin = request.headers.get("Origin") ?? "*";
  const method = request.headers.get("Access-Control-Request-Method") ?? "";
  
  if (method) {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
        "Access-Control-Allow-Headers": request.headers.get("Access-Control-Request-Headers") ?? "",
        "Access-Control-Max-Age": "86400"
      }
    });
  }

  return new Response(null, {
    headers: { Allow: "GET, HEAD, POST, OPTIONS" }
  });
};