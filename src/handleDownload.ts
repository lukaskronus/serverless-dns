// src/handleDownload.ts
import { ADDRESS, WORKER_ADDRESS } from "./const.ts";
import { verify } from "./verify.ts";

export const handleDownload = async (request: Request): Promise<Response> => {
  const origin = request.headers.get("origin") ?? "*";
  const url = new URL(request.url);
  const path = decodeURIComponent(url.pathname);
  const sign = url.searchParams.get("sign") ?? "";

  const verifyResult = await verify(path, sign);
  if (verifyResult) {
    return new Response(
      JSON.stringify({ code: 401, message: verifyResult }),
      { 
        headers: { 
          "content-type": "application/json;charset=UTF-8",
          "Access-Control-Allow-Origin": origin 
        } 
      }
    );
  }

  const init = {
    method: "POST",
    headers: {
      "content-type": "application/json;charset=UTF-8",
      Authorization: TOKEN
    },
    body: JSON.stringify({ path })
  };

  let response = await fetch(`${ADDRESS}/api/fs/link`, init);
  let result = await response.json();
  
  if (result.code !== 200) {
    return new Response(JSON.stringify(result));
  }

  let finalRequest = new Request(result.data.url, request);
  if (result.data.header) {
    for (const [k, vs] of Object.entries(result.data.header)) {
      for (const v of vs) {
        finalRequest.headers.set(k, v);
      }
    }
  }

  let finalResponse = await fetch(finalRequest);
  while (finalResponse.status >= 300 && finalResponse.status < 400) {
    const location = finalResponse.headers.get("Location");
    if (!location) break;
    finalRequest = new Request(location, finalRequest);
    finalResponse = await fetch(finalRequest);
  }

  const cleanResponse = new Response(finalResponse.body, finalResponse);
  cleanResponse.headers.delete("set-cookie");
  cleanResponse.headers.set("Access-Control-Allow-Origin", origin);
  cleanResponse.headers.append("Vary", "Origin");
  
  return cleanResponse;
};