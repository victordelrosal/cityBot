const UPSTREAM = {
  "/station_information": "https://gbfs.citibikenyc.com/gbfs/en/station_information.json",
  "/station_status": "https://gbfs.citibikenyc.com/gbfs/en/station_status.json",
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const upstream = UPSTREAM[url.pathname];
    if (!upstream) {
      return new Response("Not found. Use /station_information or /station_status.", {
        status: 404,
        headers: CORS_HEADERS,
      });
    }

    const upstreamResponse = await fetch(upstream, { cf: { cacheTtl: 30, cacheEverything: true } });
    const final = new Response(upstreamResponse.body, upstreamResponse);
    final.headers.set("Cache-Control", "public, max-age=30");
    final.headers.set("Access-Control-Allow-Origin", "*");
    return final;
  },
};
