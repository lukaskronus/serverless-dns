// src/handleRequest.ts
async function handleRequest(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return handleOptions(request);
  }
  return await handleDownload(request);
}