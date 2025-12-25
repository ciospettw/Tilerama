# Tilerama

[![npm](https://img.shields.io/npm/v/tilerama.svg)](https://www.npmjs.com/package/tilerama)
[![types](https://img.shields.io/npm/types/tilerama.svg)](https://www.npmjs.com/package/tilerama)
[![license](https://img.shields.io/npm/l/tilerama.svg)](https://www.npmjs.com/package/tilerama)

> A TypeScript-first toolkit for downloading, cleaning, routing, and plotting OpenStreetMap street networks with **graphology**.

Inspired by OSMnx but built for the Node.js ecosystem.

## Highlights

- Fetch networks from Overpass via bbox, center+distance, address/place name (Nominatim), GeoJSON polygon, or local OSM XML.
- Returns a `graphology` `MultiDirectedGraph` with OSM tags, edge lengths, CRS metadata, and helpers to keep the largest component.
- Built-in simplification and truncation to clip networks to bboxes or polygons.
- Conversion + validation helpers: GeoJSON/GDF, GraphML-like, projections, and geometry utilities.
- Routing and analysis: Dijkstra shortest paths, implicit speed handling, stats (lengths, intersections, circuity).
- Visualization: quick Leaflet HTML plotter and color helpers for nodes/edges.
- Sensible defaults for caching, rate limiting, headers, and user-agent etiquette.

## Install

```sh
npm install tilerama
```

## Quickstart

### 1) Download a network (bbox)

BBox order is **`[north, south, east, west]`**.

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

### 2) From a place name + optional trimming

```ts
import { graph_from_place, truncate_graph_bbox, largest_component } from "tilerama";

const G2 = await graph_from_place("Lisbon, Portugal", 1, "drive"); // which_result=1 → first geocoder match
const clipped = truncate_graph_bbox(G2, bbox, true);
const giant = largest_component(clipped);
```

### 3) Convert to GeoJSON and plot

```ts
import { graph_to_geojson, plot_graph } from "tilerama";

const { nodes, edges } = graph_to_geojson(giant);
const htmlPath = plot_graph(giant, { filepath: "network.html" });
console.log(nodes.features.length, edges.features.length, htmlPath);
```

### 4) Route between two nodes

```ts
import { shortest_path } from "tilerama";

const [origin, destination] = giant.nodes().slice(0, 2);
const path = shortest_path(giant, origin, destination, "length");
```

## API at a glance

All functions are exported from `src/index.ts`.

- **Graph construction**: `graph_from_bbox`, `graph_from_point`, `graph_from_address`, `graph_from_place`, `graph_from_polygon`, `graph_from_xml`, `_create_graph`.
- **Cleanup & trimming**: `simplify_graph`, `truncate_graph_bbox`, `truncate_graph_polygon`, `largest_component`, `get_largest_component`.
- **Conversion & validation**: `graph_to_geojson`, `graph_to_gdfs`, `graph_from_gdfs`, `validate_graph`, `validate_node_edge_gdfs`, `validate_features_gdf`, `to_digraph`, `to_undirected`.
- **Routing & analysis**: `shortest_path`, `add_edge_speeds`, `add_edge_travel_times`, `basic_stats`, `count_streets_per_node`, `edge_length_total`, `intersection_count`, `circuity_avg`.
- **Utilities**: distance/bearing (`great_circle`, `haversine`), projection helpers, Overpass/Nominatim helpers, geometry utils, color helpers (`get_colors`, `get_node_colors_by_attr`, `get_edge_colors_by_attr`), interactive plotting (`plot_graph`).

## Configuration

Tilerama exposes a mutable `settings` object.

```ts
import { settings } from "tilerama";

settings.use_cache = true;
settings.cache_folder = "./cache";
settings.overpass_rate_limit = true;
settings.overpass_url = "https://overpass.kumi.systems/api";
settings.http_user_agent = "MyCoolApp (contact@example.com)";
```

Key toggles:

- `use_cache`, `cache_folder`
- `overpass_url`, `overpass_rate_limit`, `overpass_memory`
- `http_user_agent`, `http_referer`, `http_accept_language`
- `requests_timeout`
- `bidirectional_network_types`, `all_oneway`

## Development

```sh
npm install
npm run build
```

Outputs are written to `dist/`. Published files include `dist/`, `README.md`, and `package.json`.

## Data sources & etiquette

Tilerama talks to public Overpass and Nominatim endpoints by default. Please:

- Keep `overpass_rate_limit` enabled and set a descriptive `User-Agent`/`Referer`.
- Avoid abusive request patterns; cache when you can.
- Respect OpenStreetMap, Overpass, and Nominatim usage policies.

## License

MIT
