# Tilerama

[![npm](https://img.shields.io/npm/v/tilerama.svg)](https://www.npmjs.com/package/tilerama)
[![types](https://img.shields.io/npm/types/tilerama.svg)](https://www.npmjs.com/package/tilerama)
[![license](https://img.shields.io/npm/l/tilerama.svg)](https://www.npmjs.com/package/tilerama)

Tilerama is a Node.js/TypeScript library for acquiring, constructing, analyzing, and visualizing street networks from OpenStreetMap.

It is inspired by OSMnx-style workflows, but designed for the JavaScript/TypeScript ecosystem.

## What you get

- Build `graphology` `MultiDirectedGraph` street networks from:
  - a lat/lon bbox
  - a center point + distance
  - an address/place name (via Nominatim)
  - a GeoJSON polygon
- Fetch OSM data via the Overpass API (with basic caching + optional rate limiting).
- Simplify graphs topologically (`simplify_graph`) and truncate by bbox/polygon.
- Helpers for conversion (`graph_to_geojson`), routing, stats, plotting, distance/bearing utilities.

## Install

```sh
npm install tilerama
```

## Quickstart

### 1) Download a network by bbox

Tilerama bbox order is **`[north, south, east, west]`**.

```ts
import { graph_from_bbox } from "tilerama";

const bbox: [number, number, number, number] = [
  37.80,  // north
  37.78,  // south
  -122.40, // east
  -122.43  // west
];

const G = await graph_from_bbox(bbox, "drive", true);
console.log(G.order, G.size);
```

### 2) Keep only the largest component

```ts
import { largest_component } from "tilerama";

const G2 = largest_component(G); // weakly connected by default
```

### 3) Truncate by bbox (including edges that cross the boundary)

```ts
import { truncate_graph_bbox } from "tilerama";

// truncate_by_edge=true retains outside nodes if an incident edge intersects the bbox
const G3 = truncate_graph_bbox(G, bbox, true);
```

## Core concepts

### Graph format

Tilerama’s primary graph structure is a `graphology` `MultiDirectedGraph`.

- Nodes typically have numeric `x` (lon) and `y` (lat)
- Edges typically have `length` and may carry `geometry` as a GeoJSON `LineString`

### Data sources and usage etiquette

This library queries public services (Overpass + Nominatim by default). Please:

- Set a reasonable `User-Agent` / `Referer` (defaults point at this repo)
- Avoid hammering endpoints; keep `overpass_rate_limit` enabled for basic pacing
- Respect OpenStreetMap and Overpass/Nominatim usage policies

## API overview

Tilerama exports functions from `src/index.ts`. A few high-level entry points:

### Graph construction

- `graph_from_bbox(bbox, network_type?, simplify?, retain_all?, truncate_by_edge?, custom_filter?)`
- `graph_from_point(center_point, dist?, network_type?, simplify?, retain_all?, truncate_by_edge?, custom_filter?)`
- `graph_from_address(address, dist?, dist_type?, network_type?, simplify?, retain_all?, truncate_by_edge?, custom_filter?)`
- `graph_from_place(query, which_result?, network_type?, simplify?, retain_all?, truncate_by_edge?, custom_filter?)`
- `graph_from_polygon(polygon, network_type?, simplify?, retain_all?, truncate_by_edge?, custom_filter?)`

### Simplification and truncation

- `simplify_graph(G, remove_rings?, track_merged?)`
- `truncate_graph_bbox(G, bbox, truncate_by_edge?, retain_all?)`
- `truncate_graph_polygon(G, polygon, retain_all?)`

### Conversion

- `graph_to_geojson(G)` → `{ nodes, edges }` FeatureCollections

## Configuration

Tilerama uses a single exported settings object that you can modify at runtime.

```ts
import { settings } from "tilerama";

settings.use_cache = true;
settings.cache_folder = "./cache";
settings.requests_timeout = 180;

// If you run your own Overpass instance:
// settings.overpass_url = "https://your.overpass.instance/api";
```

Common settings:

- `use_cache`, `cache_folder`
- `overpass_url`, `overpass_rate_limit`, `overpass_settings`, `overpass_memory`
- `http_user_agent`, `http_referer`, `http_accept_language`

## Development

```sh
npm install
npm run build
```

The package builds to `dist/` and publishes only `dist/` + `README.md` + `package.json`.

## License

MIT
