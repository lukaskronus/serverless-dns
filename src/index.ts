// src/index.ts
export default {
  async fetch(request: Request): Promise<Response> {
    return await handleRequest(request);
  },
};