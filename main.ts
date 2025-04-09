// Replace global variables with Deno environment variables
const ADDRESS = Deno.env.get("ADDRESS");
const TOKEN = Deno.env.get("TOKEN");
const WORKER_ADDRESS = Deno.env.get("WORKER_ADDRESS");

// verify.ts
const verify = async (data: string, _sign: string) => {
  const signSlice = _sign.split(":");
  if (!signSlice[signSlice.length - 1]) {
    return "expire missing";
  }
  const expire = parseInt(signSlice[signSlice.length - 1]);
  if (isNaN(expire)) {
    return "expire invalid";
  }
  if (expire < Date.now() / 1e3 && expire > 0) {
    return "expire expired";
  }
  const right = await hmacSha256Sign(data, expire);
  if (_sign !== right) {
    return "sign mismatch";
  }
  return "";
};

const hmacSha256Sign = async (data: string, expire: number) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(TOKEN),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  const buf = await crypto.subtle.sign(
    { name: "HMAC", hash: "SHA-256" },
    key,
    new TextEncoder().encode(`${data}:${expire}`)
  );
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_") + `:${expire}`;
};

// handleDownload.ts
async function handleDownload(request: Request) {
  const origin = request.headers.get("origin") ?? "*";
  const url = new URL(request.url);
  const path = decodeURIComponent(url.pathname);
  const sign = url.searchParams.get("sign") ?? "";
  const verifyResult = await verify(path, sign);
  
  if (verifyResult !== "") {
    const resp = new Response(
      JSON.stringify({
        code: 401,
        message: verifyResult
      }),
      { headers: { "content-type": "application/json;charset=UTF-8" } }
    );
    resp.headers.set("Access-Control-Allow-Origin", origin);
    return resp;
  }

  let resp = await fetch(`${ADDRESS}/api/fs/link`, {
    method: "POST",
    headers: {
      "content-type": "application/json;charset=UTF-8",
      Authorization: TOKEN!
    },
    body: JSON.stringify({ path })
  });

  let res = await resp.json();
  if (res.code !== 200) {
    return new Response(JSON.stringify(res));
  }

  let newRequest = new Request(res.data.url, request);
  if (res.data.header) {
    for (const k in res.data.header) {
      for (const v of res.data.header[k]) {
        newRequest.headers.set(k, v);
      }
    }
  }

  let response = await fetch(newRequest);
  while (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("Location");
    if (location) {
      if (location.startsWith(`${WORKER_ADDRESS}/`)) {
        newRequest = new Request(location, request);
        return await handleRequest(newRequest);
      } else {
        newRequest = new Request(location, request);
        response = await fetch(newRequest);
      }
    } else break;
  }

  response = new Response(response.body, response);
  response.headers.delete("set-cookie");
  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.append("Vary", "Origin");
  return response;
}

// handleOptions.ts
function handleOptions(request: Request) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
    "Access-Control-Max-Age": "86400"
  };

  if (
    request.headers.get("Origin") !== null &&
    request.headers.get("Access-Control-Request-Method") !== null
  ) {
    return new Response(null, {
      headers: {
        ...corsHeaders,
        "Access-Control-Allow-Headers": request.headers.get("Access-Control-Request-Headers") || ""
      }
    });
  }

  return new Response(null, {
    headers: { Allow: "GET, HEAD, POST, OPTIONS" }
  });
}

// handleRequest.ts
async function handleRequest(request: Request) {
  if (request.method === "OPTIONS") return handleOptions(request);
  return await handleDownload(request);
}

// Main export
export default {
  async fetch(request: Request) {
    return await handleRequest(request);
  }
};