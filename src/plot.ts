import { MultiDirectedGraph } from "graphology";
import * as fs from "fs";
import * as path from "path";
import { graph_to_geojson } from "./convert";
import { log } from "./utils";
import { FeatureCollection } from "geojson";

interface PlotOptions {
  filepath?: string;
  separate?: boolean;
  bgcolor?: string;
  node_color?: string | string[];
  node_size?: number;
  edge_color?: string | string[];
  edge_linewidth?: number;
  route_color?: string;
  route_linewidth?: number;
  orig_dest_color?: string;
}

/**
 * Generate color interpolation between two colors.
 * 
 * @param n - Number of colors to generate
 * @param cmap - Color scheme name (viridis, plasma, hot, cool, etc.)
 * @returns Array of hex color strings
 */
export function get_colors(n: number, cmap: string = "viridis"): string[] {
  const colors: string[] = [];
  
  // Simplified color maps (RGB interpolation)
  const colormaps: Record<string, [number, number, number][]> = {
    viridis: [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]],
    plasma: [[13, 8, 135], [126, 3, 168], [204, 71, 120], [248, 149, 64], [240, 249, 33]],
    hot: [[0, 0, 0], [128, 0, 0], [255, 0, 0], [255, 128, 0], [255, 255, 0], [255, 255, 255]],
    cool: [[0, 255, 255], [128, 128, 255], [255, 0, 255]],
    spring: [[255, 0, 255], [255, 255, 0]],
    summer: [[0, 128, 102], [255, 255, 102]],
    autumn: [[255, 0, 0], [255, 255, 0]],
    winter: [[0, 0, 255], [0, 255, 128]],
    gray: [[0, 0, 0], [255, 255, 255]],
  };
  
  const colorStops = colormaps[cmap] || colormaps.viridis;
  
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    const pos = t * (colorStops.length - 1);
    const idx = Math.floor(pos);
    const frac = pos - idx;
    
    const c1 = colorStops[Math.min(idx, colorStops.length - 1)];
    const c2 = colorStops[Math.min(idx + 1, colorStops.length - 1)];
    
    const r = Math.round(c1[0] + (c2[0] - c1[0]) * frac);
    const g = Math.round(c1[1] + (c2[1] - c1[1]) * frac);
    const b = Math.round(c1[2] + (c2[2] - c1[2]) * frac);
    
    colors.push(`#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`);
  }
  
  return colors;
}

/**
 * Assign colors to nodes based on attribute values.
 * 
 * @param G - Graph
 * @param attr - Node attribute name
 * @param cmap - Color scheme
 * @returns Map of node ID to color hex string
 */
export function get_node_colors_by_attr(
  G: MultiDirectedGraph,
  attr: string,
  cmap: string = "viridis"
): Map<string, string> {
  const values: number[] = [];
  const nodeIds: string[] = [];
  
  G.forEachNode((node, attrs) => {
    if (attrs[attr] !== undefined && typeof attrs[attr] === "number") {
      values.push(attrs[attr]);
      nodeIds.push(node);
    }
  });
  
  if (values.length === 0) {
    log(`No numeric attribute '${attr}' found on nodes`, "WARNING");
    return new Map();
  }
  
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;
  
  const colors = get_colors(100, cmap);
  const colorMap = new Map<string, string>();
  
  nodeIds.forEach((nodeId, i) => {
    const val = values[i];
    const normalized = (val - minVal) / range;
    const colorIdx = Math.floor(normalized * (colors.length - 1));
    colorMap.set(nodeId, colors[colorIdx]);
  });
  
  return colorMap;
}

/**
 * Assign colors to edges based on attribute values.
 * 
 * @param G - Graph
 * @param attr - Edge attribute name
 * @param cmap - Color scheme
 * @returns Map of edge key to color hex string
 */
export function get_edge_colors_by_attr(
  G: MultiDirectedGraph,
  attr: string,
  cmap: string = "viridis"
): Map<string, string> {
  const values: number[] = [];
  const edgeKeys: string[] = [];
  
  G.forEachEdge((edge, attrs) => {
    if (attrs[attr] !== undefined && typeof attrs[attr] === "number") {
      values.push(attrs[attr]);
      edgeKeys.push(edge);
    }
  });
  
  if (values.length === 0) {
    log(`No numeric attribute '${attr}' found on edges`, "WARNING");
    return new Map();
  }
  
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;
  
  const colors = get_colors(100, cmap);
  const colorMap = new Map<string, string>();
  
  edgeKeys.forEach((edgeKey, i) => {
    const val = values[i];
    const normalized = (val - minVal) / range;
    const colorIdx = Math.floor(normalized * (colors.length - 1));
    colorMap.set(edgeKey, colors[colorIdx]);
  });
  
  return colorMap;
}

/**
 * Plot graph as interactive HTML map with Leaflet.
 * Generates a standalone HTML file with embedded GeoJSON.
 * 
 * @param G - Graph to plot
 * @param options - Plot options
 * @returns Path to generated HTML file
 */
export function plot_graph(G: MultiDirectedGraph, options: PlotOptions = {}): string {
  const {
    filepath = "graph.html",
    bgcolor = "#1a1a1a",
    node_color = "#66ccff",
    node_size = 15,
    edge_color = "#999999",
    edge_linewidth = 2,
  } = options;
  
  const { nodes, edges } = graph_to_geojson(G);
  
  // Calculate map center
  let sumLat = 0, sumLon = 0, count = 0;
  for (const feature of nodes.features) {
    const [lon, lat] = feature.geometry.coordinates;
    sumLon += lon;
    sumLat += lat;
    count++;
  }
  const centerLat = sumLat / count;
  const centerLon = sumLon / count;
  
  const html = generateLeafletHTML(nodes, edges, {
    center: [centerLat, centerLon],
    zoom: 14,
    bgcolor,
    node_color: Array.isArray(node_color) ? node_color[0] : node_color,
    node_size,
    edge_color: Array.isArray(edge_color) ? edge_color[0] : edge_color,
    edge_linewidth,
  });
  
  fs.writeFileSync(filepath, html);
  log(`Generated interactive map: ${filepath}`, "INFO");
  
  return filepath;
}

/**
 * Plot graph with a route highlighted.
 * 
 * @param G - Graph
 * @param route - Array of node IDs forming the route
 * @param options - Plot options
 * @returns Path to generated HTML file
 */
export function plot_graph_route(
  G: MultiDirectedGraph,
  route: string[],
  options: PlotOptions = {}
): string {
  const {
    filepath = "graph_route.html",
    bgcolor = "#1a1a1a",
    node_color = "#999999",
    node_size = 10,
    edge_color = "#666666",
    edge_linewidth = 2,
    route_color = "#ff3333",
    route_linewidth = 4,
    orig_dest_color = "#33ff33",
  } = options;
  
  const { nodes, edges } = graph_to_geojson(G);
  
  // Build route GeoJSON
  const routeCoords: [number, number][] = [];
  for (const nodeId of route) {
    if (G.hasNode(nodeId)) {
      const attrs = G.getNodeAttributes(nodeId);
      routeCoords.push([attrs.x, attrs.y]);
    }
  }
  
  const routeFeature = {
    type: "Feature" as const,
    geometry: {
      type: "LineString" as const,
      coordinates: routeCoords,
    },
    properties: { route: true },
  };
  
  // Calculate center from route
  const centerLat = routeCoords.reduce((sum, c) => sum + c[1], 0) / routeCoords.length;
  const centerLon = routeCoords.reduce((sum, c) => sum + c[0], 0) / routeCoords.length;
  
  const html = generateLeafletHTMLWithRoute(nodes, edges, routeFeature, {
    center: [centerLat, centerLon],
    zoom: 15,
    bgcolor,
    node_color: Array.isArray(node_color) ? node_color[0] : node_color,
    node_size,
    edge_color: Array.isArray(edge_color) ? edge_color[0] : edge_color,
    edge_linewidth,
    route_color: route_color,
    route_linewidth,
    orig_dest_color,
    routeStart: routeCoords[0],
    routeEnd: routeCoords[routeCoords.length - 1],
  });
  
  fs.writeFileSync(filepath, html);
  log(`Generated route map: ${filepath}`, "INFO");
  
  return filepath;
}

/**
 * Plot graph with multiple routes highlighted.
 * 
 * @param G - Graph
 * @param routes - Array of routes (each route is array of node IDs)
 * @param options - Plot options
 * @returns Path to generated HTML file
 */
export function plot_graph_routes(
  G: MultiDirectedGraph,
  routes: string[][],
  options: PlotOptions = {}
): string {
  const {
    filepath = "graph_routes.html",
    bgcolor = "#1a1a1a",
    node_color = "#999999",
    node_size = 10,
    edge_color = "#666666",
    edge_linewidth = 2,
    route_linewidth = 4,
  } = options;
  
  const { nodes, edges } = graph_to_geojson(G);
  
  // Generate colors for routes
  const routeColors = get_colors(routes.length, "viridis");
  
  // Build route GeoJSONs
  const routeFeatures = routes.map((route, idx) => {
    const routeCoords: [number, number][] = [];
    for (const nodeId of route) {
      if (G.hasNode(nodeId)) {
        const attrs = G.getNodeAttributes(nodeId);
        routeCoords.push([attrs.x, attrs.y]);
      }
    }
    
    return {
      type: "Feature" as const,
      geometry: {
        type: "LineString" as const,
        coordinates: routeCoords,
      },
      properties: { route: true, color: routeColors[idx] },
    };
  });
  
  // Calculate center from first route
  const firstRoute = routeFeatures[0].geometry.coordinates;
  const centerLat = firstRoute.reduce((sum, c) => sum + c[1], 0) / firstRoute.length;
  const centerLon = firstRoute.reduce((sum, c) => sum + c[0], 0) / firstRoute.length;
  
  const html = generateLeafletHTMLWithRoutes(nodes, edges, routeFeatures, {
    center: [centerLat, centerLon],
    zoom: 15,
    bgcolor,
    node_color: Array.isArray(node_color) ? node_color[0] : node_color,
    node_size,
    edge_color: Array.isArray(edge_color) ? edge_color[0] : edge_color,
    edge_linewidth,
    route_linewidth,
  });
  
  fs.writeFileSync(filepath, html);
  log(`Generated routes map with ${routes.length} routes: ${filepath}`, "INFO");
  
  return filepath;
}

/**
 * Plot building footprints from features FeatureCollection.
 * 
 * @param footprints - FeatureCollection of building footprints
 * @param options - Plot options
 * @returns Path to generated HTML file
 */
export function plot_footprints(
  footprints: FeatureCollection,
  options: PlotOptions = {}
): string {
  const {
    filepath = "footprints.html",
    bgcolor = "#1a1a1a",
    edge_color = "#ffcc00",
    edge_linewidth = 1,
  } = options;
  
  // Calculate center
  let sumLat = 0, sumLon = 0, count = 0;
  for (const feature of footprints.features) {
    if (feature.geometry.type === "Polygon") {
      const coords = feature.geometry.coordinates[0];
      for (const [lon, lat] of coords) {
        sumLon += lon;
        sumLat += lat;
        count++;
      }
    }
  }
  const centerLat = sumLat / count;
  const centerLon = sumLon / count;
  
  const html = generateLeafletHTMLFootprints(footprints, {
    center: [centerLat, centerLon],
    zoom: 16,
    bgcolor,
    edge_color: Array.isArray(edge_color) ? edge_color[0] : edge_color,
    edge_linewidth,
  });
  
  fs.writeFileSync(filepath, html);
  log(`Generated footprints map: ${filepath}`, "INFO");
  
  return filepath;
}

/**
 * Generate polar histogram (rose diagram) of edge bearings.
 * Creates an HTML file with Chart.js polar chart.
 * 
 * @param G - Graph with edge bearings
 * @param options - Plot options
 * @returns Path to generated HTML file
 */
export function plot_orientation(
  G: MultiDirectedGraph,
  options: PlotOptions = {}
): string {
  const { filepath = "orientation.html", bgcolor = "#ffffff" } = options;
  
  // Collect bearings
  const bearings: number[] = [];
  G.forEachEdge((edge, attrs) => {
    if (attrs.bearing !== undefined) {
      bearings.push(attrs.bearing);
    }
  });
  
  if (bearings.length === 0) {
    log("No bearings found on edges. Run add_edge_bearings() first.", "WARNING");
    return "";
  }
  
  // Create histogram (36 bins, 10° each)
  const numBins = 36;
  const binSize = 360 / numBins;
  const bins = new Array(numBins).fill(0);
  
  for (const bearing of bearings) {
    const binIdx = Math.floor(bearing / binSize) % numBins;
    bins[binIdx]++;
  }
  
  // Generate labels
  const labels = bins.map((_, i) => `${(i * binSize).toFixed(0)}°`);
  
  const html = generateChartJSPolar(labels, bins, {
    title: "Street Network Orientation",
    bgcolor,
  });
  
  fs.writeFileSync(filepath, html);
  log(`Generated orientation plot: ${filepath}`, "INFO");
  
  return filepath;
}

/** Alias for plot_graph for parity with folium output. */
export function plot_graph_folium(G: MultiDirectedGraph, options: PlotOptions = {}): string {
  return plot_graph(G, options);
}

/** Alias for plot_graph for figure-ground style. */
export function plot_figure_ground(G: MultiDirectedGraph, options: PlotOptions = {}): string {
  return plot_graph(G, { ...options, bgcolor: "#ffffff", edge_color: "#000000" });
}

// HTML template generation functions
function generateLeafletHTML(nodes: any, edges: any, config: any): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Tilerama Graph</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    body { margin: 0; padding: 0; background: ${config.bgcolor}; }
    #map { position: absolute; top: 0; bottom: 0; width: 100%; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    const map = L.map('map').setView([${config.center[0]}, ${config.center[1]}], ${config.zoom});
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap © CartoDB',
      subdomains: 'abcd',
      maxZoom: 19
    }).addTo(map);
    
    // Edges
    const edgesData = ${JSON.stringify(edges)};
    L.geoJSON(edgesData, {
      style: { color: '${config.edge_color}', weight: ${config.edge_linewidth}, opacity: 0.7 }
    }).addTo(map);
    
    // Nodes
    const nodesData = ${JSON.stringify(nodes)};
    L.geoJSON(nodesData, {
      pointToLayer: (feature, latlng) => {
        return L.circleMarker(latlng, {
          radius: ${config.node_size / 3},
          fillColor: '${config.node_color}',
          color: '${config.node_color}',
          weight: 1,
          opacity: 0.8,
          fillOpacity: 0.6
        });
      }
    }).addTo(map);
  </script>
</body>
</html>`;
}

function generateLeafletHTMLWithRoute(nodes: any, edges: any, route: any, config: any): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Tilerama Route</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    body { margin: 0; padding: 0; background: ${config.bgcolor}; }
    #map { position: absolute; top: 0; bottom: 0; width: 100%; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    const map = L.map('map').setView([${config.center[0]}, ${config.center[1]}], ${config.zoom});
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap © CartoDB',
      maxZoom: 19
    }).addTo(map);
    
    // Edges
    L.geoJSON(${JSON.stringify(edges)}, {
      style: { color: '${config.edge_color}', weight: ${config.edge_linewidth}, opacity: 0.4 }
    }).addTo(map);
    
    // Route
    L.geoJSON(${JSON.stringify(route)}, {
      style: { color: '${config.route_color}', weight: ${config.route_linewidth}, opacity: 0.9 }
    }).addTo(map);
    
    // Start/End markers
    L.circleMarker([${config.routeStart[1]}, ${config.routeStart[0]}], {
      radius: 8,
      fillColor: '${config.orig_dest_color}',
      color: '#ffffff',
      weight: 2,
      opacity: 1,
      fillOpacity: 0.8
    }).addTo(map).bindPopup('Start');
    
    L.circleMarker([${config.routeEnd[1]}, ${config.routeEnd[0]}], {
      radius: 8,
      fillColor: '${config.route_color}',
      color: '#ffffff',
      weight: 2,
      opacity: 1,
      fillOpacity: 0.8
    }).addTo(map).bindPopup('End');
    
    // Nodes
    L.geoJSON(${JSON.stringify(nodes)}, {
      pointToLayer: (feature, latlng) => {
        return L.circleMarker(latlng, {
          radius: ${config.node_size / 3},
          fillColor: '${config.node_color}',
          color: '${config.node_color}',
          weight: 1,
          opacity: 0.3,
          fillOpacity: 0.3
        });
      }
    }).addTo(map);
  </script>
</body>
</html>`;
}

function generateLeafletHTMLWithRoutes(nodes: any, edges: any, routes: any[], config: any): string {
  const routesJSON = routes.map(r => `
    L.geoJSON(${JSON.stringify(r)}, {
      style: { color: '${r.properties.color}', weight: ${config.route_linewidth}, opacity: 0.8 }
    }).addTo(map);
  `).join('\n');
  
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Tilerama Routes</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    body { margin: 0; padding: 0; background: ${config.bgcolor}; }
    #map { position: absolute; top: 0; bottom: 0; width: 100%; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    const map = L.map('map').setView([${config.center[0]}, ${config.center[1]}], ${config.zoom});
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap © CartoDB',
      maxZoom: 19
    }).addTo(map);
    
    // Edges
    L.geoJSON(${JSON.stringify(edges)}, {
      style: { color: '${config.edge_color}', weight: ${config.edge_linewidth}, opacity: 0.3 }
    }).addTo(map);
    
    // Routes
    ${routesJSON}
    
    // Nodes
    L.geoJSON(${JSON.stringify(nodes)}, {
      pointToLayer: (feature, latlng) => {
        return L.circleMarker(latlng, {
          radius: ${config.node_size / 3},
          fillColor: '${config.node_color}',
          color: '${config.node_color}',
          weight: 1,
          opacity: 0.3,
          fillOpacity: 0.3
        });
      }
    }).addTo(map);
  </script>
</body>
</html>`;
}

function generateLeafletHTMLFootprints(footprints: any, config: any): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Building Footprints</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    body { margin: 0; padding: 0; background: ${config.bgcolor}; }
    #map { position: absolute; top: 0; bottom: 0; width: 100%; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    const map = L.map('map').setView([${config.center[0]}, ${config.center[1]}], ${config.zoom});
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap © CartoDB',
      maxZoom: 19
    }).addTo(map);
    
    L.geoJSON(${JSON.stringify(footprints)}, {
      style: {
        color: '${config.edge_color}',
        weight: ${config.edge_linewidth},
        opacity: 0.8,
        fillOpacity: 0.5
      },
      onEachFeature: (feature, layer) => {
        if (feature.properties.name) {
          layer.bindPopup(feature.properties.name);
        }
      }
    }).addTo(map);
  </script>
</body>
</html>`;
}

function generateChartJSPolar(labels: string[], data: number[], config: any): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${config.title}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    body {
      margin: 0;
      padding: 20px;
      background: ${config.bgcolor};
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
    }
    #chartContainer {
      width: 80%;
      max-width: 800px;
    }
  </style>
</head>
<body>
  <div id="chartContainer">
    <canvas id="chart"></canvas>
  </div>
  <script>
    const ctx = document.getElementById('chart').getContext('2d');
    new Chart(ctx, {
      type: 'polarArea',
      data: {
        labels: ${JSON.stringify(labels)},
        datasets: [{
          label: 'Street Count',
          data: ${JSON.stringify(data)},
          backgroundColor: 'rgba(54, 162, 235, 0.5)',
          borderColor: 'rgba(54, 162, 235, 1)',
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        plugins: {
          title: {
            display: true,
            text: '${config.title}',
            font: { size: 20 }
          },
          legend: {
            display: false
          }
        },
        scales: {
          r: {
            beginAtZero: true
          }
        }
      }
    });
  </script>
</body>
</html>`;
}
