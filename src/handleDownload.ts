// src/handleDownload.ts
async function handleDownload(request: Request): Promise<Response> {
  const origin = request.headers.get("origin") ?? "*";
  const url = new URL(request.url);
  const path = decodeURIComponent(url.pathname);
  const sign = url.searchParams.get("sign") ?? "";
  const verifyResult = await verify(path, sign);

  if (verifyResult !== "") {
    const resp = new Response(
      JSON.stringify({
        code: 401,
        message: verifyResult,
      }),
      {
        headers: {
          "content-type": "application/json;charset=UTF-8",
        },
      }
    );
    resp.headers.set("Access-Control-Allow-Origin", origin);
    return resp;
  }

  let resp = await fetch(`${ADDRESS}/api/fs/link`, {
    method: "POST",
    headers: {
      "content-type": "application/json;charset=UTF-8",
      Authorization: TOKEN,
    },
    body: JSON.stringify({ path }),
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
    } else {
      break;
    }
  }

  response = new Response(response.body, response);
  response.headers.delete("set-cookie");
  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.append("Vary", "Origin");
  return response;
}

// src/handleOptions.ts
function handleOptions(request: Request): Response {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
    "Access-Control-Max-Age": "86400",
  };

  const headers = request.headers;
  if (
    headers.get("Origin") !== null &&
    headers.get("Access-Control-Request-Method") !== null
  ) {
    const respHeaders = {
      ...corsHeaders,
      "Access-Control-Allow-Headers":
        headers.get("Access-Control-Request-Headers") || "",
    };
    return new Response(null, { headers: respHeaders });
  } else {
    return new Response(null, {
      headers: {
        Allow: "GET, HEAD, POST, OPTIONS",
      },
    });
  }
}
