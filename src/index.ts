// src/index.ts
import { handleRequest } from "./handleRequest.ts";

export default {
  async fetch(request: Request): Promise<Response> {
    return await handleRequest(request);
  }
};