import { MultiDirectedGraph } from "graphology";
import { log } from "./utils";
import { great_circle } from "./distance";

/**
 * Count the streets (edges) incident on each node.
 * 
 * @param G - Input graph.
 * @param nodes - List of node IDs to calculate counts for. If undefined, calculate for all nodes.
 */
export function count_streets_per_node(
  G: MultiDirectedGraph,
  nodes?: string[]
): Record<string, number> {
  const street_counts: Record<string, number> = {};
  const has_self_loop: Record<string, boolean> = {};

  // Initialize counts for requested nodes (or all)
  const nodes_to_process = nodes || G.nodes();
  const node_set = new Set(nodes_to_process);
  
  for (const node of nodes_to_process) {
      street_counts[node] = 0;
  }

  G.forEachEdge((edge, attr, source, target) => {
      if (source === target) {
          if (node_set.has(source)) {
              has_self_loop[source] = true;
          }
      } else {
          if (node_set.has(source)) street_counts[source] = (street_counts[source] || 0) + 1;
          if (node_set.has(target)) street_counts[target] = (street_counts[target] || 0) + 1;
      }
  });

  for (const node of nodes_to_process) {
      if (has_self_loop[node]) {
          street_counts[node] += 2;
      }
  }
  
  return street_counts;
}

export function edge_length_total(G: MultiDirectedGraph): number {
    let total = 0;
    G.forEachEdge((edge, attr) => {
        if (attr.length) {
            total += Number(attr.length);
        }
    });
    return total;
}

export function intersection_count(G: MultiDirectedGraph, min_streets: number = 2): number {
    let count = 0;
    const street_counts = count_streets_per_node(G);
    for (const c of Object.values(street_counts)) {
        if (c >= min_streets) count++;
    }
    return count;
}

export function basic_stats(G: MultiDirectedGraph, area?: number): Record<string, any> {
    const stats: Record<string, any> = {};
    
    stats["n"] = G.order;
    stats["m"] = G.size;
    stats["k_avg"] = G.order > 0 ? (2 * G.size) / G.order : 0;
    stats["edge_length_total"] = edge_length_total(G);
    stats["edge_length_avg"] = G.size > 0 ? stats["edge_length_total"] / G.size : 0;
    
    const street_counts = count_streets_per_node(G);
    const street_counts_values = Object.values(street_counts);
    const sum_counts = street_counts_values.reduce((a, b) => a + b, 0);
    stats["streets_per_node_avg"] = G.order > 0 ? sum_counts / G.order : 0;
    
    stats["intersection_count"] = intersection_count(G);
    
    if (area) {
        stats["node_density_km"] = stats["n"] / (area / 1e6);
        stats["intersection_density_km"] = stats["intersection_count"] / (area / 1e6);
        stats["edge_density_km"] = stats["edge_length_total"] / (area / 1e6);
    }

    return stats;
}

/**
 * Total street length treating reciprocal directed edges as a single undirected segment.
 */
export function street_length_total(G: MultiDirectedGraph): number {
    const seen = new Set<string>();
    let total = 0;
    G.forEachEdge((edge, attr, u, v) => {
        const key = u < v ? `${u}|${v}` : `${v}|${u}`;
        if (seen.has(key)) return;
        seen.add(key);
        if (attr.length !== undefined) {
            total += Number(attr.length);
        }
    });
    return total;
}

/**
 * Average circuity = edge_length / straight_line_distance (meters). Returns null if not computable.
 */
export function circuity_avg(G: MultiDirectedGraph): number | null {
    let totalRatio = 0;
    let count = 0;

    G.forEachEdge((edge, attr, u, v) => {
        const uAttr = G.getNodeAttributes(u);
        const vAttr = G.getNodeAttributes(v);
        if (uAttr?.y === undefined || uAttr?.x === undefined || vAttr?.y === undefined || vAttr?.x === undefined) {
            return;
        }

        // edge length: use provided length or compute great-circle
        let edgeLen = attr.length !== undefined ? Number(attr.length) : great_circle(uAttr.y, uAttr.x, vAttr.y, vAttr.x);

        // straight-line distance between endpoints
        const straight = great_circle(uAttr.y, uAttr.x, vAttr.y, vAttr.x);
        if (straight <= 0) return;

        totalRatio += edgeLen / straight;
        count += 1;
    });

    if (count === 0) return null;
    return totalRatio / count;
}

/** Proportion of edges that are self-loops. */
export function self_loop_proportion(G: MultiDirectedGraph): number {
        if (G.size === 0) return 0;
        let loops = 0;
        G.forEachEdge((edge, attr, u, v) => {
                if (u === v) loops += 1;
        });
        return loops / G.size;
}

/** Count undirected street segments (reciprocal directed edges count once). */
export function street_segment_count(G: MultiDirectedGraph): number {
        const seen = new Set<string>();
        let count = 0;
        G.forEachEdge((edge, attr, u, v) => {
                const key = u < v ? `${u}|${v}` : `${v}|${u}`;
                if (!seen.has(key)) {
                        seen.add(key);
                        count += 1;
                }
        });
        return count;
}

/** Streets per node helper (alias of count_streets_per_node). */
export function streets_per_node(
    G: MultiDirectedGraph,
    nodes?: string[]
): Record<string, number> {
    return count_streets_per_node(G, nodes);
}

/** Average number of streets per node. */
export function streets_per_node_avg(G: MultiDirectedGraph): number {
    const counts = Object.values(count_streets_per_node(G));
    if (counts.length === 0) return 0;
    const sum = counts.reduce((a, b) => a + b, 0);
    return sum / counts.length;
}

/** Calculate streets-per-node counts. Returns dict keyed by count of streets per node. */
export function streets_per_node_counts(G: MultiDirectedGraph): Record<number, number> {
    const spn = streets_per_node(G);
    const spn_vals = Object.values(spn);
    
    if (spn_vals.length === 0) return {};
    
    const max_count = Math.max(...spn_vals);
    const counts: Record<number, number> = {};
    
    // Initialize all counts from 0 to max
    for (let i = 0; i <= max_count; i++) {
        counts[i] = 0;
    }
    
    // Count occurrences
    for (const val of spn_vals) {
        counts[val]++;
    }
    
    return counts;
}

/** Proportions of nodes by street-count degree (e.g., 1-way, 3-way). */
export function streets_per_node_proportions(G: MultiDirectedGraph): Record<number, number> {
    const n = G.order;
    const spnc = streets_per_node_counts(G);
    const proportions: Record<number, number> = {};
    
    for (const [count_str, num_nodes] of Object.entries(spnc)) {
        proportions[Number(count_str)] = num_nodes / n;
    }
    
    return proportions;
}
