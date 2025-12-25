import { MultiDirectedGraph } from "graphology";
import { log } from "./utils";
import * as utils_geo from "./utils_geo";
import * as turf from "@turf/turf";
import booleanIntersects from "@turf/boolean-intersects";
import * as wellknown from "wellknown";
import { get_largest_component } from "./utils_graph";

/**
 * Return the largest weakly or strongly connected component of the graph.
 * 
 * @param G - Input graph
 * @param strongly - If true, return largest strongly connected component. Otherwise weakly.
 * @returns The largest connected component subgraph
 */
export function largest_component(
  G: MultiDirectedGraph,
  strongly: boolean = false
): MultiDirectedGraph {
  return get_largest_component(G, strongly);
}

/**
 * Remove every node in the graph that falls outside the bounding box.
 * 
 * @param G - The graph to truncate.
 * @param bbox - Bounding box [north, south, east, west].
 * @param truncate_by_edge - If true, retain nodes outside bbox if they are connected to an edge that intersects the bbox.
 * @param retain_all - If true, return the entire graph even if it is not connected.
 * @returns The truncated graph.
 */
export function truncate_graph_bbox(
  G: MultiDirectedGraph,
  bbox: [number, number, number, number],
  truncate_by_edge: boolean = false,
  retain_all: boolean = false
): MultiDirectedGraph {
  const [north, south, east, west] = bbox;
  let nodes_to_remove: string[] = [];

  // Identify nodes outside the bbox
  G.forEachNode((node, attributes) => {
    const y = attributes.y;
    const x = attributes.x;
    
    if (y > north || y < south || x > east || x < west) {
      nodes_to_remove.push(node);
    }
  });

  // If truncate_by_edge is true, we need to check edges
  if (truncate_by_edge) {
    const bboxPoly = utils_geo.bbox_to_poly(bbox);
    const outside = new Set(nodes_to_remove);
    const keepOutside = new Set<string>();

    G.forEachEdge((edge, attributes, source, target) => {
      if (!outside.has(source) && !outside.has(target)) return;

      // Derive edge LineString coordinates.
      let coordinates: number[][] = [];

      if (attributes.geometry) {
        if (attributes.geometry.type === "LineString" && Array.isArray(attributes.geometry.coordinates)) {
          coordinates = attributes.geometry.coordinates;
        } else if (typeof attributes.geometry === "string") {
          try {
            const geo = wellknown.parse(attributes.geometry);
            if (geo && geo.type === "LineString" && Array.isArray((geo as any).coordinates)) {
              coordinates = (geo as any).coordinates;
            }
          } catch {
            // ignore parse errors
          }
        } else if (Array.isArray(attributes.geometry)) {
          coordinates = attributes.geometry;
        }
      }

      // Fallback to a straight segment between the incident nodes.
      if (coordinates.length < 2) {
        const u = G.getNodeAttributes(source);
        const v = G.getNodeAttributes(target);
        if (
          u?.x !== undefined && u?.y !== undefined && v?.x !== undefined && v?.y !== undefined &&
          Number.isFinite(Number(u.x)) && Number.isFinite(Number(u.y)) &&
          Number.isFinite(Number(v.x)) && Number.isFinite(Number(v.y))
        ) {
          coordinates = [
            [Number(u.x), Number(u.y)],
            [Number(v.x), Number(v.y)]
          ];
        }
      }

      if (coordinates.length < 2) return;

      // Turf expects [x, y] coordinate pairs.
      const line = turf.lineString(coordinates);
      if (booleanIntersects(line, bboxPoly)) {
        if (outside.has(source)) keepOutside.add(source);
        if (outside.has(target)) keepOutside.add(target);
      }
    });

    const before = nodes_to_remove.length;
    nodes_to_remove = nodes_to_remove.filter((n) => !keepOutside.has(n));
    const kept = before - nodes_to_remove.length;
    if (kept > 0) {
      log(`truncate_by_edge=True retained ${kept} outside nodes connected by bbox-intersecting edges.`, "INFO");
    }
  }

  // Remove the nodes
  nodes_to_remove.forEach(node => {
    if (G.hasNode(node)) {
        G.dropNode(node);
    }
  });

  log(`Truncated graph by bbox. Removed ${nodes_to_remove.length} nodes.`, "INFO");
  
  if (!retain_all) {
    log("Retaining only the largest weakly connected component.", "INFO");
    return get_largest_component(G);
  }

  return G;
}

/**
 * Remove every node in the graph that falls outside the polygon.
 * 
 * @param G - The graph to truncate.
 * @param polygon - Turf Polygon or MultiPolygon.
 * @param retain_all - If true, return the entire graph even if it is not connected.
 * @returns The truncated graph.
 */
export function truncate_graph_polygon(
    G: MultiDirectedGraph,
    polygon: any,
    retain_all: boolean = false
): MultiDirectedGraph {
    const nodes_to_remove: string[] = [];

    G.forEachNode((node, attributes) => {
        const pt = turf.point([attributes.x, attributes.y]);
        if (!turf.booleanPointInPolygon(pt, polygon)) {
            nodes_to_remove.push(node);
        }
    });

    nodes_to_remove.forEach(node => {
        if (G.hasNode(node)) {
            G.dropNode(node);
        }
    });

    log(`Truncated graph by polygon. Removed ${nodes_to_remove.length} nodes.`, "INFO");

    if (!retain_all) {
      log("Retaining only the largest weakly connected component.", "INFO");
      return get_largest_component(G);
    }

    return G;
}

/**
 * Remove nodes farther than dist (meters) from source node, based on weighted shortest paths.
 */
export function truncate_graph_dist(
  G: MultiDirectedGraph,
  source: string,
  dist: number,
  weight: string = "length",
  retain_all: boolean = false
): MultiDirectedGraph {
  if (!G.hasNode(source)) {
    throw new Error(`Source node ${source} not in graph.`);
  }

  // Build adjacency with weights
  const adj: Record<string, { v: string; w: number }[]> = {};
  G.forEachEdge((edge, attr, u, v) => {
    const w = attr[weight] !== undefined ? Number(attr[weight]) : 1;
    if (!Number.isFinite(w)) return;
    if (!adj[u]) adj[u] = [];
    adj[u].push({ v, w });
  });

  // Dijkstra from source
  const distMap: Record<string, number> = {};
  const visited: Set<string> = new Set();
  distMap[source] = 0;

  while (true) {
    let current: string | null = null;
    let best = Number.POSITIVE_INFINITY;
    for (const [node, d] of Object.entries(distMap)) {
      if (!visited.has(node) && d < best) {
        best = d;
        current = node;
      }
    }
    if (current === null) break;
    visited.add(current);
    if (best > dist) continue; // no need to relax farther
    const neighbors = adj[current] || [];
    for (const { v, w } of neighbors) {
      const nd = best + w;
      if (nd < (distMap[v] ?? Number.POSITIVE_INFINITY)) {
        distMap[v] = nd;
      }
    }
  }

  const toRemove: string[] = [];
  G.forEachNode((node) => {
    const d = distMap[node];
    if (!Number.isFinite(d) || d > dist) {
      toRemove.push(node);
    }
  });

  for (const n of toRemove) {
    if (G.hasNode(n)) G.dropNode(n);
  }

  log(`Truncated graph by distance ${dist}m from ${source}. Removed ${toRemove.length} nodes.`, "INFO");

  if (!retain_all) {
    return get_largest_component(G);
  }
  return G;
}
