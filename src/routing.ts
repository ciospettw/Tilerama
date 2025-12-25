import { MultiDirectedGraph } from "graphology";
import { FeatureCollection, Feature, Point, LineString } from "geojson";
import { dijkstra } from "graphology-shortest-path";
import * as utils from "./utils";

// Dict that is used by `add_edge_speeds` to convert implicit values
// to numbers, based on https://wiki.openstreetmap.org/wiki/Key:maxspeed
const _IMPLICIT_MAXSPEEDS: { [key: string]: number } = {
    "AR:rural": 110.0,
    "AR:urban": 40.0,
    "AR:urban:primary": 60.0,
    "AR:urban:secondary": 60.0,
    "AT:bicycle_road": 30.0,
    "AT:motorway": 130.0,
    "AT:rural": 100.0,
    "AT:trunk": 100.0,
    "AT:urban": 50.0,
    "BE-BRU:rural": 70.0,
    "BE-BRU:urban": 30.0,
    "BE-VLG:rural": 70.0,
    "BE-VLG:urban": 50.0,
    "BE-WAL:rural": 90.0,
    "BE-WAL:urban": 50.0,
    "BE:cyclestreet": 30.0,
    "BE:living_street": 20.0,
    "BE:motorway": 120.0,
    "BE:trunk": 120.0,
    "BE:zone30": 30.0,
    "BG:living_street": 20.0,
    "BG:motorway": 140.0,
    "BG:rural": 90.0,
    "BG:trunk": 120.0,
    "BG:urban": 50.0,
    "BY:living_street": 20.0,
    "BY:motorway": 110.0,
    "BY:rural": 90.0,
    "BY:urban": 60.0,
    "CA-AB:rural": 90.0,
    "CA-AB:urban": 65.0,
    "CA-BC:rural": 80.0,
    "CA-BC:urban": 50.0,
    "CA-MB:rural": 90.0,
    "CA-MB:urban": 50.0,
    "CA-ON:rural": 80.0,
    "CA-ON:urban": 50.0,
    "CA-QC:motorway": 100.0,
    "CA-QC:rural": 75.0,
    "CA-QC:urban": 50.0,
    "CA-SK:nsl": 80.0,
    "CH:motorway": 120.0,
    "CH:rural": 80.0,
    "CH:trunk": 100.0,
    "CH:urban": 50.0,
    "CZ:living_street": 20.0,
    "CZ:motorway": 130.0,
    "CZ:pedestrian_zone": 20.0,
    "CZ:rural": 90.0,
    "CZ:trunk": 110.0,
    "CZ:urban": 50.0,
    "CZ:urban_motorway": 80.0,
    "CZ:urban_trunk": 80.0,
    "DE:bicycle_road": 30.0,
    "DE:living_street": 15.0,
    "DE:motorway": 120.0,
    "DE:rural": 80.0,
    "DE:urban": 50.0,
    "DK:motorway": 130.0,
    "DK:rural": 80.0,
    "DK:urban": 50.0,
    "EE:rural": 90.0,
    "EE:urban": 50.0,
    "ES:living_street": 20.0,
    "ES:motorway": 120.0,
    "ES:rural": 90.0,
    "ES:trunk": 90.0,
    "ES:urban": 50.0,
    "ES:zone30": 30.0,
    "FI:motorway": 120.0,
    "FI:rural": 80.0,
    "FI:trunk": 100.0,
    "FI:urban": 50.0,
    "FR:motorway": 120.0,
    "FR:rural": 80.0,
    "FR:urban": 50.0,
    "FR:zone30": 30.0,
    "GB:nsl_restricted": 48.28,
    "GR:motorway": 130.0,
    "GR:rural": 90.0,
    "GR:trunk": 110.0,
    "GR:urban": 50.0,
    "HU:living_street": 20.0,
    "HU:motorway": 130.0,
    "HU:rural": 90.0,
    "HU:trunk": 110.0,
    "HU:urban": 50.0,
    "IT:motorway": 130.0,
    "IT:rural": 90.0,
    "IT:trunk": 110.0,
    "IT:urban": 50.0,
    "JP:express": 100.0,
    "JP:nsl": 60.0,
    "LT:rural": 90.0,
    "LT:urban": 50.0,
    "NO:rural": 80.0,
    "NO:urban": 50.0,
    "PH:express": 100.0,
    "PH:rural": 80.0,
    "PH:urban": 30.0,
    "PT:motorway": 120.0,
    "PT:rural": 90.0,
    "PT:trunk": 100.0,
    "PT:urban": 50.0,
    "RO:motorway": 130.0,
    "RO:rural": 90.0,
    "RO:trunk": 100.0,
    "RO:urban": 50.0,
    "RS:living_street": 10.0,
    "RS:motorway": 130.0,
    "RS:rural": 80.0,
    "RS:trunk": 100.0,
    "RS:urban": 50.0,
    "RU:living_street": 20.0,
    "RU:motorway": 110.0,
    "RU:rural": 90.0,
    "RU:urban": 60.0,
    "SE:rural": 70.0,
    "SE:urban": 50.0,
    "SI:motorway": 130.0,
    "SI:rural": 90.0,
    "SI:trunk": 110.0,
    "SI:urban": 50.0,
    "SK:living_street": 20.0,
    "SK:motorway": 130.0,
    "SK:motorway_urban": 90.0,
    "SK:rural": 90.0,
    "SK:trunk": 90.0,
    "SK:urban": 50.0,
    "TR:living_street": 20.0,
    "TR:motorway": 130.0,
    "TR:rural": 90.0,
    "TR:trunk": 110.0,
    "TR:urban": 50.0,
    "TR:zone30": 30.0,
    "UA:living_street": 20.0,
    "UA:motorway": 130.0,
    "UA:rural": 90.0,
    "UA:trunk": 110.0,
    "UA:urban": 50.0,
    "UK:motorway": 112.65,
    "UK:nsl_dual": 112.65,
    "UK:nsl_single": 96.56,
    "UZ:living_street": 30.0,
    "UZ:motorway": 110.0,
    "UZ:rural": 100.0,
    "UZ:urban": 70.0,
};

/**
 * Solve shortest path from origin node(s) to destination node(s).
 *
 * @param G - Input graph.
 * @param orig - Origin node ID(s).
 * @param dest - Destination node ID(s).
 * @param weight - Edge attribute to minimize when solving shortest path.
 */
export function shortest_path(
    G: MultiDirectedGraph,
    orig: string | string[],
    dest: string | string[],
    weight: string = "length"
): string[] | (string[] | null)[] | null {
    
    if (Array.isArray(orig) && Array.isArray(dest)) {
        if (orig.length !== dest.length) {
            throw new Error("`orig` and `dest` must be of equal length.");
        }
        return orig.map((o, i) => _single_shortest_path(G, o, dest[i], weight));
    } else if (!Array.isArray(orig) && !Array.isArray(dest)) {
        return _single_shortest_path(G, orig as string, dest as string, weight);
    } else {
        throw new Error("`orig` and `dest` must either both be iterable or neither must be iterable.");
    }
}

function _single_shortest_path(
    G: MultiDirectedGraph,
    orig: string,
    dest: string,
    weight: string
): string[] | null {
    try {
        // graphology-shortest-path dijkstra returns the path as array of nodes
        const path = dijkstra.bidirectional(G, orig, dest, weight);
        return path;
    } catch (e) {
        utils.log(`Cannot solve path from ${orig} to ${dest}`, "WARNING");
        return null;
    }
}

function _build_adj(G: MultiDirectedGraph, weight: string): Record<string, Record<string, number>> {
    const adj: Record<string, Record<string, number>> = {};
    G.forEachEdge((edge, attr, u, v) => {
        const w = attr[weight] !== undefined ? Number(attr[weight]) : 1;
        if (!Number.isFinite(w)) return;
        if (!adj[u]) adj[u] = {};
        // keep minimal weight if multiple edges
        adj[u][v] = Math.min(adj[u][v] ?? Number.POSITIVE_INFINITY, w);
    });
    return adj;
}

function _dijkstra_with_ignores(
    adj: Record<string, Record<string, number>>,
    orig: string,
    dest: string,
    ignoredEdges: Set<string>,
    ignoredNodes: Set<string>
): string[] | null {
    interface Item { node: string; dist: number; prev?: string }
    const dist: Record<string, number> = {};
    const prev: Record<string, string | undefined> = {};
    const visited: Set<string> = new Set();
    dist[orig] = 0;

    while (true) {
        let current: string | null = null;
        let best = Number.POSITIVE_INFINITY;
        for (const [node, d] of Object.entries(dist)) {
            if (!visited.has(node) && d < best) {
                best = d;
                current = node;
            }
        }
        if (current === null) break;
        if (current === dest) break;
        visited.add(current);
        const neighbors = adj[current];
        if (!neighbors) continue;
        for (const [v, w] of Object.entries(neighbors)) {
            if (ignoredNodes.has(v) && v !== dest) continue;
            const edgeKey = `${current}->${v}`;
            if (ignoredEdges.has(edgeKey)) continue;
            const nd = best + w;
            if (nd < (dist[v] ?? Number.POSITIVE_INFINITY)) {
                dist[v] = nd;
                prev[v] = current;
            }
        }
    }

    if (!(dest in dist)) return null;
    const path: string[] = [];
    let cur: string | undefined = dest;
    while (cur !== undefined) {
        path.unshift(cur);
        cur = prev[cur];
    }
    return path;
}

function _path_cost(adj: Record<string, Record<string, number>>, path: string[]): number {
    let cost = 0;
    for (let i = 0; i < path.length - 1; i++) {
        const u = path[i];
        const v = path[i + 1];
        const w = adj[u]?.[v];
        cost += w ?? 1;
    }
    return cost;
}

/**
 * Compute k-shortest loopless paths using Yen's algorithm.
 */
export function k_shortest_paths(
    G: MultiDirectedGraph,
    orig: string,
    dest: string,
    k: number = 1,
    weight: string = "length"
): string[][] {
    if (k < 1) return [];
    const adj = _build_adj(G, weight);
    const A: string[][] = [];
    const first = _dijkstra_with_ignores(adj, orig, dest, new Set(), new Set());
    if (!first) return [];
    A.push(first);
    const B: { path: string[]; cost: number }[] = [];

    for (let ki = 1; ki < k; ki++) {
        const prev_path = A[ki - 1];
        for (let i = 0; i < prev_path.length - 1; i++) {
            const spur_node = prev_path[i];
            const root_path = prev_path.slice(0, i + 1);

            const ignoredEdges = new Set<string>();
            for (const p of A) {
                if (p.length > i && p.slice(0, i + 1).every((v, idx) => v === root_path[idx])) {
                    const edgeKey = `${p[i]}->${p[i + 1]}`;
                    ignoredEdges.add(edgeKey);
                }
            }

            const ignoredNodes = new Set<string>(root_path.slice(0, -1));

            const spur_path = _dijkstra_with_ignores(adj, spur_node, dest, ignoredEdges, ignoredNodes);
            if (spur_path) {
                const total_path = root_path.slice(0, -1).concat(spur_path);
                const cost = _path_cost(adj, total_path);
                // avoid duplicates
                if (!B.some((b) => b.path.length === total_path.length && b.path.every((v, idx) => v === total_path[idx]))) {
                    B.push({ path: total_path, cost });
                }
            }
        }

        if (B.length === 0) break;
        B.sort((a, b) => a.cost - b.cost);
        const best = B.shift()!;
        A.push(best.path);
    }

    return A;
}

/** Convert a node path to GeoJSON FeatureCollections for nodes and edges. */
export function route_to_gdf(
    G: MultiDirectedGraph,
    path: string[]
): { nodes: FeatureCollection<Point>; edges: FeatureCollection<LineString> } {
    const nodeFeatures: Feature<Point>[] = [];
    const edgeFeatures: Feature<LineString>[] = [];

    for (const node of path) {
        const attr = G.getNodeAttributes(node);
        if (attr?.x !== undefined && attr?.y !== undefined) {
            nodeFeatures.push({
                type: "Feature",
                geometry: { type: "Point", coordinates: [Number(attr.x), Number(attr.y)] },
                properties: { id: node, ...attr },
            });
        }
    }

    for (let i = 0; i < path.length - 1; i++) {
        const u = path[i];
        const v = path[i + 1];
        const edges = G.edges(u, v);
        const edgeId = edges[0];
        const attr = edgeId ? G.getEdgeAttributes(edgeId) : {};
        const uAttr = G.getNodeAttributes(u);
        const vAttr = G.getNodeAttributes(v);

        let coords: number[][] = [];
        if (attr?.geometry && attr.geometry.type === "LineString") {
            coords = attr.geometry.coordinates;
        } else if (uAttr?.x !== undefined && uAttr?.y !== undefined && vAttr?.x !== undefined && vAttr?.y !== undefined) {
            coords = [ [Number(uAttr.x), Number(uAttr.y)], [Number(vAttr.x), Number(vAttr.y)] ];
        }
        if (coords.length === 0) continue;

        edgeFeatures.push({
            type: "Feature",
            geometry: { type: "LineString", coordinates: coords },
            properties: { id: edgeId ?? `${u}-${v}`, u, v, ...attr },
        });
    }

    return {
        nodes: { type: "FeatureCollection", features: nodeFeatures },
        edges: { type: "FeatureCollection", features: edgeFeatures },
    };
}

/**
 * Add edge speeds (km per hour) to graph as new `speed_kph` edge attributes.
 */
export function add_edge_speeds(
    G: MultiDirectedGraph,
    hwy_speeds?: { [key: string]: number },
    fallback?: number
): MultiDirectedGraph {
    
    // Calculate mean speeds for each highway type
    const hwy_speed_stats: { [key: string]: number[] } = {};
    
    G.forEachEdge((edge, attributes) => {
        const hwy = attributes.highway;
        if (!hwy) return;
        
        // Handle list of highways (take first)
        const hwyType = Array.isArray(hwy) ? hwy[0] : hwy;
        
        if (attributes.maxspeed) {
            const speed = _clean_maxspeed(attributes.maxspeed);
            if (speed !== null) {
                if (!hwy_speed_stats[hwyType]) hwy_speed_stats[hwyType] = [];
                hwy_speed_stats[hwyType].push(speed);
            }
        }
    });

    const hwy_speed_avg: { [key: string]: number } = {};
    for (const hwy in hwy_speed_stats) {
        const speeds = hwy_speed_stats[hwy];
        const sum = speeds.reduce((a, b) => a + b, 0);
        hwy_speed_avg[hwy] = sum / speeds.length;
    }

    // Merge with user provided hwy_speeds
    if (hwy_speeds) {
        Object.assign(hwy_speed_avg, hwy_speeds);
    }

    // Calculate global mean for fallback
    let global_sum = 0;
    let global_count = 0;
    for (const hwy in hwy_speed_avg) {
        global_sum += hwy_speed_avg[hwy];
        global_count++;
    }
    const global_mean = global_count > 0 ? global_sum / global_count : NaN;
    const final_fallback = fallback !== undefined ? fallback : global_mean;

    if (isNaN(final_fallback) && Object.keys(hwy_speed_avg).length === 0) {
         // If no speeds at all and no fallback
         // "This graph's edges have no preexisting 'maxspeed' attribute values..."
         // We'll just log warning and set nulls if we can't determine speed.
    }

    G.forEachEdge((edge, attributes) => {
        let speed_kph: number | null = null;
        
        // Try maxspeed
        if (attributes.maxspeed) {
             // collapse multiple maxspeed values
             const collapsed = _collapse_multiple_maxspeed_values(attributes.maxspeed);
             if (collapsed !== null) {
                 // clean and convert
                 speed_kph = _clean_maxspeed(collapsed);
             }
        }

        if (speed_kph === null) {
            const hwy = attributes.highway;
            if (hwy) {
                const hwyType = Array.isArray(hwy) ? hwy[0] : hwy;
                if (hwy_speed_avg[hwyType]) {
                    speed_kph = hwy_speed_avg[hwyType];
                } else {
                    speed_kph = final_fallback;
                }
            } else {
                speed_kph = final_fallback;
            }
        }
        
        if (speed_kph !== null && !isNaN(speed_kph)) {
            G.setEdgeAttribute(edge, "speed_kph", speed_kph);
        }
    });

    return G;
}

/**
 * Add edge travel time (seconds) to graph as new `travel_time` edge attributes.
 */
export function add_edge_travel_times(G: MultiDirectedGraph): MultiDirectedGraph {
    G.forEachEdge((edge, attributes) => {
        if (attributes.length !== undefined && attributes.speed_kph !== undefined) {
            const length_m = Number(attributes.length);
            const speed_kph = Number(attributes.speed_kph);
            
            if (!isNaN(length_m) && !isNaN(speed_kph) && speed_kph > 0) {
                const distance_km = length_m / 1000;
                const speed_km_sec = speed_kph / 3600;
                const travel_time = distance_km / speed_km_sec;
                G.setEdgeAttribute(edge, "travel_time", travel_time);
            }
        }
    });
    return G;
}

function _clean_maxspeed(maxspeed: string | number, convert_mph: boolean = true): number | null {
    const MILES_TO_KM = 1.60934;
    
    if (typeof maxspeed !== 'string') {
        return typeof maxspeed === 'number' ? maxspeed : null;
    }

    // Split on |
    const values = maxspeed.split('|');
    const clean_values: number[] = [];

    const pattern = /^([0-9][\.,0-9]+?)(?:[ ]?(?:km\/h|kmh|kph|mph|knots))?$/;

    for (const value of values) {
        const match = value.trim().match(pattern);
        if (match) {
            let val = parseFloat(match[1].replace(',', '.'));
            if (convert_mph && maxspeed.toLowerCase().includes('mph')) {
                val = val * MILES_TO_KM;
            }
            clean_values.push(val);
        } else {
            // Try implicit
            const implicit = _IMPLICIT_MAXSPEEDS[value.trim()];
            if (implicit) {
                clean_values.push(implicit);
            }
        }
    }

    if (clean_values.length === 0) return null;
    
    // Mean
    const sum = clean_values.reduce((a, b) => a + b, 0);
    return sum / clean_values.length;
}

function _collapse_multiple_maxspeed_values(value: any): string | number | null {
    if (!Array.isArray(value)) return value;
    
    // It's a list. Clean each and average.
    const values: number[] = [];
    for (const v of value) {
        const cleaned = _clean_maxspeed(v);
        if (cleaned !== null) values.push(cleaned);
    }
    
    if (values.length === 0) return null;
    const sum = values.reduce((a, b) => a + b, 0);
    return sum / values.length;
}
