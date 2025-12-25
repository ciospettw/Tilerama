import { MultiDirectedGraph } from "graphology";
import { log } from "./utils";
import KDBush from "kdbush";
import * as geokdbush from "geokdbush";
import RBush from "rbush";
import { pointToLineDistance, point, lineString } from "@turf/turf";

const EARTH_RADIUS_M = 6_371_009;

/**
 * Calculate great-circle distances between pairs of points.
 * Expects coordinates in decimal degrees.
 */
export function great_circle(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  earth_radius: number = EARTH_RADIUS_M
): number {
  const y1 = (lat1 * Math.PI) / 180;
  const y2 = (lat2 * Math.PI) / 180;
  const delta_y = y2 - y1;

  const x1 = (lon1 * Math.PI) / 180;
  const x2 = (lon2 * Math.PI) / 180;
  const delta_x = x2 - x1;

  const h =
    Math.sin(delta_y / 2) ** 2 +
    Math.cos(y1) * Math.cos(y2) * Math.sin(delta_x / 2) ** 2;
  
  // protect against floating point errors
  const h_clamped = Math.min(1, h);
  const arc = 2 * Math.asin(Math.sqrt(h_clamped));

  return arc * earth_radius;
}

/**
 * Calculate Euclidean distances between pairs of points.
 */
export function euclidean(
  y1: number,
  x1: number,
  y2: number,
  x2: number
): number {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

/**
 * Calculate and add `length` attribute (in meters) to each edge.
 */
export function add_edge_lengths(
  G: MultiDirectedGraph,
  edges?: string[]
): MultiDirectedGraph {
  const edgeKeys = edges || G.edges();

  for (const edge of edgeKeys) {
    const [u, v] = G.extremities(edge);
    const uNode = G.getNodeAttributes(u);
    const vNode = G.getNodeAttributes(v);

    if (uNode && vNode && uNode.y !== undefined && uNode.x !== undefined && vNode.y !== undefined && vNode.x !== undefined) {
      const dist = great_circle(uNode.y, uNode.x, vNode.y, vNode.x);
      G.setEdgeAttribute(edge, "length", dist);
    }
  }

  log("Added length attributes to graph edges", "INFO");
  return G;
}

/**
 * Find the nearest node to a point or to each of several points.
 * 
 * @param G - Graph in which to find nearest nodes.
 * @param X - The points' x (longitude) coordinates.
 * @param Y - The points' y (latitude) coordinates.
 * @param return_dist - If true, optionally also return the distance(s).
 */
export function nearest_nodes(
    G: MultiDirectedGraph,
    X: number | number[],
    Y: number | number[],
    return_dist: boolean = false
): string | string[] | [string, number] | [string[], number[]] {
    
    const is_scalar = typeof X === 'number' && typeof Y === 'number';
    const X_arr = Array.isArray(X) ? X : [X as number];
    const Y_arr = Array.isArray(Y) ? Y : [Y as number];

    if (X_arr.length !== Y_arr.length) {
        throw new Error("X and Y must be of equal length.");
    }

    // Prepare points for index
    const points: {id: string, x: number, y: number}[] = [];
    G.forEachNode((node, attr) => {
        if (attr.x !== undefined && attr.y !== undefined) {
            points.push({ id: node, x: attr.x, y: attr.y });
        }
    });
    const index = new KDBush(points, (p) => p.x, (p) => p.y);

    const nn_array: string[] = [];
    const dist_array: number[] = [];

    for (let i = 0; i < X_arr.length; i++) {
        const x = X_arr[i];
        const y = Y_arr[i];
        const nearest = geokdbush.around(index, x, y, 1);
        
        if (nearest.length > 0) {
            const n = nearest[0] as {id: string, x: number, y: number};
            nn_array.push(n.id);
            if (return_dist) {
                // Calculate distance
                const d = great_circle(y, x, n.y, n.x);
                dist_array.push(d);
            }
        } else {
            // Should not happen if graph has nodes
            throw new Error("No nearest node found.");
        }
    }

    if (is_scalar) {
        if (return_dist) {
            return [nn_array[0], dist_array[0]];
        }
        return nn_array[0];
    }

    if (return_dist) {
        return [nn_array, dist_array];
    }
    return nn_array;
}

/**
 * Find the nearest edge to a point or to each of several points.
 * Returns edge tuples [u, v, key]. If return_dist, also returns distance in meters.
 */
export function nearest_edges(
  G: MultiDirectedGraph,
  X: number | number[],
  Y: number | number[],
  return_dist: boolean = false
): [string, string, number] | [string, string, number][] | [[string, string, number], number] | [[string, string, number][], number[]] {
  const is_scalar = typeof X === "number" && typeof Y === "number";
  const X_arr = Array.isArray(X) ? X : [X as number];
  const Y_arr = Array.isArray(Y) ? Y : [Y as number];

  if (X_arr.length !== Y_arr.length) {
    throw new Error("X and Y must be of equal length.");
  }

  // Precompute edge geometries as LineStrings
  const edgeGeoms: { source: string; target: string; key: number; ls: any }[] = [];
  G.forEachEdge((edge, attr, source, target) => {
    let coords: [number, number][] | null = null;
    if (attr.geometry && Array.isArray(attr.geometry.coordinates)) {
      coords = attr.geometry.coordinates as [number, number][];
    }
    if (!coords) {
      const u = G.getNodeAttributes(source);
      const v = G.getNodeAttributes(target);
      if (u?.x !== undefined && u?.y !== undefined && v?.x !== undefined && v?.y !== undefined) {
        coords = [ [u.x, u.y], [v.x, v.y] ];
      }
    }
    if (coords && coords.length >= 2) {
      // Extract key from parallel edges (assume key = 0 for now)
      edgeGeoms.push({ source, target, key: 0, ls: lineString(coords) });
    }
  });

  if (edgeGeoms.length === 0) {
    throw new Error("Graph has no edges with coordinates to compute nearest_edges.");
  }

  const nearest: [string, string, number][] = [];
  const dists: number[] = [];

  for (let i = 0; i < X_arr.length; i++) {
    const pt = point([X_arr[i], Y_arr[i]]);
    let bestEdge: [string, string, number] | null = null;
    let bestDist = Number.POSITIVE_INFINITY;

    for (const { source, target, key, ls } of edgeGeoms) {
      const d = pointToLineDistance(pt, ls, { units: "meters" });
      if (d < bestDist) {
        bestDist = d;
        bestEdge = [source, target, key];
      }
    }

    if (!bestEdge) {
      throw new Error("No nearest edge found.");
    }
    nearest.push(bestEdge);
    if (return_dist) dists.push(bestDist);
  }

  if (is_scalar) {
    if (return_dist) return [nearest[0], dists[0]];
    return nearest[0];
  }
  if (return_dist) return [nearest, dists];
  return nearest;
}

