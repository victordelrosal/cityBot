# citybot-mcp

MCP server exposing live NYC Citi Bike station data (GBFS feed, no API key required).

Tools:
- `search_stations(query)` — find stations by name substring
- `station_status(name)` — live bikes/docks available at a station
- `nearest_available_station(lat, lon, need)` — closest stations with a bike to rent or a dock to return to

## Build

```
npm install
npm run build
```

## Connect to Claude Code / Claude Desktop

Add to your MCP config (e.g. `claude_desktop_config.json` or via `claude mcp add`):

```json
{
  "mcpServers": {
    "citybike-nyc": {
      "command": "node",
      "args": ["/Users/victordelrosal/Dropbox/Dropbox24/fiveinnolabs/SmallBets/cityBot/dist/index.js"]
    }
  }
}
```

Restart the client, then ask things like "how many bikes are available near Grand Army Plaza?"
