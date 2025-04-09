// src/verify.ts
import { TOKEN } from "./const.ts";

export const verify = async (data: string, _sign: string): Promise<string> => {
  const signSlice = _sign.split(":");
  if (!signSlice[signSlice.length - 1]) return "expire missing";
  
  const expire = parseInt(signSlice[signSlice.length - 1]);
  if (isNaN(expire)) return "expire invalid";
  if (expire < Date.now() / 1e3 && expire > 0) return "expire expired";
  
  const right = await hmacSha256Sign(data, expire);
  return _sign === right ? "" : "sign mismatch";
};

const hmacSha256Sign = async (data: string, expire: number): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(TOKEN),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${data}:${expire}`)
  );
  
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_") + ":" + expire;
};