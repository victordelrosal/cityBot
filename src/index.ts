#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const STATION_INFO_URL = "https://gbfs.citibikenyc.com/gbfs/en/station_information.json";
const STATION_STATUS_URL = "https://gbfs.citibikenyc.com/gbfs/en/station_status.json";
const CACHE_MS = 60_000;

interface StationInfo {
  station_id: string;
  name: string;
  lat: number;
  lon: number;
  capacity: number;
}

interface StationStatus {
  station_id: string;
  num_bikes_available: number;
  num_docks_available: number;
  num_ebikes_available?: number;
  is_renting: number;
  is_returning: number;
}

let infoCache: { at: number; data: Map<string, StationInfo> } | null = null;
let statusCache: { at: number; data: Map<string, StationStatus> } | null = null;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`GBFS request failed: ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function getStationInfo(): Promise<Map<string, StationInfo>> {
  if (infoCache && Date.now() - infoCache.at < CACHE_MS) return infoCache.data;
  const json = await fetchJson<{ data: { stations: StationInfo[] } }>(STATION_INFO_URL);
  const map = new Map(json.data.stations.map((s) => [s.station_id, s]));
  infoCache = { at: Date.now(), data: map };
  return map;
}

async function getStationStatus(): Promise<Map<string, StationStatus>> {
  if (statusCache && Date.now() - statusCache.at < CACHE_MS) return statusCache.data;
  const json = await fetchJson<{ data: { stations: StationStatus[] } }>(STATION_STATUS_URL);
  const map = new Map(json.data.stations.map((s) => [s.station_id, s]));
  statusCache = { at: Date.now(), data: map };
  return map;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const server = new McpServer({ name: "citybike-nyc", version: "1.0.0" });

server.registerTool(
  "search_stations",
  {
    title: "Search Citi Bike stations by name",
    description:
      "Search live NYC Citi Bike stations by a name substring (case-insensitive). Returns up to 10 matches with id, lat/lon.",
    inputSchema: { query: z.string().describe("Substring to match against station name, e.g. 'Union Square'") },
  },
  async ({ query }) => {
    const info = await getStationInfo();
    const q = query.toLowerCase();
    const matches = [...info.values()]
      .filter((s) => s.name.toLowerCase().includes(q))
      .slice(0, 10)
      .map((s) => ({ station_id: s.station_id, name: s.name, lat: s.lat, lon: s.lon, capacity: s.capacity }));
    return { content: [{ type: "text", text: JSON.stringify(matches, null, 2) }] };
  }
);

server.registerTool(
  "station_status",
  {
    title: "Get live status for a Citi Bike station",
    description:
      "Look up a Citi Bike station by name (best substring match) and return its live bike/dock availability.",
    inputSchema: { name: z.string().describe("Station name or substring, e.g. 'Grand Army Plaza'") },
  },
  async ({ name }) => {
    const [info, status] = await Promise.all([getStationInfo(), getStationStatus()]);
    const q = name.toLowerCase();
    const station = [...info.values()].find((s) => s.name.toLowerCase().includes(q));
    if (!station) {
      return { content: [{ type: "text", text: `No station found matching "${name}".` }] };
    }
    const live = status.get(station.station_id);
    if (!live) {
      return { content: [{ type: "text", text: `Found station "${station.name}" but no live status is currently reported.` }] };
    }
    const result = {
      name: station.name,
      bikes_available: live.num_bikes_available,
      ebikes_available: live.num_ebikes_available ?? 0,
      docks_available: live.num_docks_available,
      capacity: station.capacity,
      is_renting: live.is_renting === 1,
      is_returning: live.is_returning === 1,
    };
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "nearest_available_station",
  {
    title: "Find nearest Citi Bike station with availability",
    description:
      "Given a latitude/longitude, find the closest live stations that currently have what you need: a bike to rent, or an open dock to return one.",
    inputSchema: {
      lat: z.number().describe("Latitude"),
      lon: z.number().describe("Longitude"),
      need: z.enum(["bike", "dock"]).default("bike").describe("'bike' to find a station to rent from, 'dock' to find one to return to"),
      limit: z.number().int().min(1).max(10).default(3),
    },
  },
  async ({ lat, lon, need, limit }) => {
    const [info, status] = await Promise.all([getStationInfo(), getStationStatus()]);
    const ranked = [...info.values()]
      .map((s) => {
        const live = status.get(s.station_id);
        return { station: s, live };
      })
      .filter(({ live }) => live && live.is_renting === 1 && live.is_returning === 1)
      .filter(({ live }) => (need === "bike" ? live!.num_bikes_available > 0 : live!.num_docks_available > 0))
      .map(({ station, live }) => ({
        name: station.name,
        distance_m: Math.round(haversineMeters(lat, lon, station.lat, station.lon)),
        bikes_available: live!.num_bikes_available,
        docks_available: live!.num_docks_available,
      }))
      .sort((a, b) => a.distance_m - b.distance_m)
      .slice(0, limit);
    return { content: [{ type: "text", text: JSON.stringify(ranked, null, 2) }] };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error starting citybike-nyc MCP server:", err);
  process.exit(1);
});
