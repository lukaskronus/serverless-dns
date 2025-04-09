// src/handleRequest.ts
import { handleDownload } from "./handleDownload.ts";
import { handleOptions } from "./handleOptions.ts";

export const handleRequest = async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") return handleOptions(request);
  return handleDownload(request);
};