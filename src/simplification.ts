import { MultiDirectedGraph } from "graphology";
import { log } from "./utils";
import * as turf from "@turf/turf";
import { count_streets_per_node } from "./stats";
import { great_circle } from "./distance";
import { is_projected } from "./projection";

/**
 * Simplify a graph's topology by removing interstitial nodes.
 * 
 * This simplifies the graph's topology by removing all nodes that are not
 * intersections or dead-ends.
 */
export function simplify_graph(
  G: MultiDirectedGraph,
  remove_rings: boolean = true,
  track_merged: boolean = false
): MultiDirectedGraph {
  if (G.getAttribute("simplified")) {
    throw new Error("This graph has already been simplified, cannot simplify it again.");
  }

  log("Begin topologically simplifying the graph...", "INFO");

  const initial_node_count = G.order;
  const initial_edge_count = G.size;
  
  // Identify endpoints
  const endpoints = new Set<string>();
  G.forEachNode((node) => {
    if (_is_endpoint(G, node)) {
      endpoints.add(node);
    }
  });

  log(`Identified ${endpoints.size} edge endpoints`, "INFO");

  const nodes_to_remove = new Set<string>();
  const edges_to_add: any[] = [];

  // Iterate over endpoints to find paths to simplify
  for (const endpoint of endpoints) {
    G.forEachOutNeighbor(endpoint, (successor) => {
      if (!endpoints.has(successor)) {
        const path = _build_path(G, endpoint, successor, endpoints);
        if (path) {
          // Process path
          const merged_edges: any[] = [];
          const path_attributes: Record<string, any> = {};
          const path_nodes = path; // [endpoint, ..., endpoint_successor]

          // Collect attributes and geometry
          const coords: any[] = [];
          
          // Add start node coord
          const startNodeAttrs = G.getNodeAttributes(path_nodes[0]);
          coords.push([startNodeAttrs.x, startNodeAttrs.y]);

          for (let i = 0; i < path_nodes.length - 1; i++) {
            const u = path_nodes[i];
            const v = path_nodes[i+1];
            
            // Get edge attributes (taking first edge if multiple)
            // Graphology MultiGraph doesn't support .edge(u, v) directly if multiple edges exist.
            // We need to get all edges and pick one.
            const edges = G.edges(u, v);
            if (edges.length === 0) continue;
            const edge = edges[0];
            
            const attrs = G.getEdgeAttributes(edge);
            
            // Merge attributes logic (simplified)
            for (const [key, val] of Object.entries(attrs)) {
                if (!path_attributes[key]) path_attributes[key] = [];
                path_attributes[key].push(val);
            }

            if (track_merged) {
                merged_edges.push([u, v]);
            }
            
            // Add v node coord
            const vNodeAttrs = G.getNodeAttributes(v);
            coords.push([vNodeAttrs.x, vNodeAttrs.y]);
            
            // Mark intermediate nodes for removal
            if (i > 0) {
                nodes_to_remove.add(u);
            }
          }

          // Consolidate attributes
          const final_attributes: Record<string, any> = {};
          for (const [key, vals] of Object.entries(path_attributes)) {
              if (key === "length") {
                const flattened: number[] = [];
                (vals as any[]).forEach((v) => {
                  if (Array.isArray(v)) {
                    v.forEach((x) => {
                      const n = Number(x);
                      if (Number.isFinite(n)) flattened.push(n);
                    });
                  } else {
                    const n = Number(v);
                    if (Number.isFinite(n)) flattened.push(n);
                  }
                });
                final_attributes[key] = flattened.reduce((acc, n) => acc + n, 0);
                continue;
              }

              const unique = [...new Set(vals as any[])];
              final_attributes[key] = unique.length === 1 ? unique[0] : unique;
          }

          // Create geometry
          // Turf expects [lon, lat] (x, y)
          final_attributes["geometry"] = turf.lineString(coords).geometry;
          
          if (track_merged) {
              final_attributes["merged_edges"] = merged_edges;
          }

          edges_to_add.push({
              u: path_nodes[0],
              v: path_nodes[path_nodes.length - 1],
              attributes: final_attributes
          });
        }
      }
    });
  }

  // Add new edges
  for (const edge of edges_to_add) {
      G.addEdge(edge.u, edge.v, edge.attributes);
  }

  // Remove nodes
  nodes_to_remove.forEach(node => {
      if (G.hasNode(node)) G.dropNode(node);
  });

  if (remove_rings) {
      
      const nodes_to_check = G.nodes();
      nodes_to_check.forEach(node => {
          // Check if node has self loop
          if (G.hasEdge(node, node)) {
              // Check degree. If degree is 2 (1 in, 1 out, both same edge), it's isolated.
              // Or if it has no other neighbors.
              const neighbors = G.neighbors(node);
              // neighbors includes self if self-loop exists.
              // If neighbors length is 1 (only itself), it is isolated.
              if (neighbors.length === 1 && neighbors[0] === node) {
                  G.dropNode(node);
              }
          }
      });
  }

  G.setAttribute("simplified", true);
  
  log(`Simplified graph: ${initial_node_count} to ${G.order} nodes, ${initial_edge_count} to ${G.size} edges`, "INFO");

  // Calculate street_count attribute for all nodes
  const street_counts = count_streets_per_node(G);
  for (const [node, count] of Object.entries(street_counts)) {
      G.setNodeAttribute(node, "street_count", count);
  }

  return G;
}

/** Merge nearby nodes (within tolerance meters) into single intersection nodes. */
export function consolidate_intersections(
  G: MultiDirectedGraph,
  tolerance: number = 10
): MultiDirectedGraph {
  const nodes = G.nodes();
  const coords: Record<string, { x: number; y: number }> = {};
  for (const n of nodes) {
    const attr = G.getNodeAttributes(n);
    if (attr?.x !== undefined && attr?.y !== undefined) {
      coords[n] = { x: Number(attr.x), y: Number(attr.y) };
    }
  }

  const graphCrs = G.getAttribute("crs");
  const projected = is_projected(typeof graphCrs === "string" ? graphCrs : undefined);

  const distance = (a: string, b: string): number => {
    const ca = coords[a];
    const cb = coords[b];
    if (!ca || !cb) return Infinity;
    if (projected) {
      // Projected CRS: x/y are meters
      const dx = ca.x - cb.x;
      const dy = ca.y - cb.y;
      return Math.sqrt(dx * dx + dy * dy);
    }
    // Unprojected WGS84: x/y are lon/lat
    return great_circle(ca.y, ca.x, cb.y, cb.x);
  };

  // tolerance is a per-node buffer radius.
  // Two nodes are merged if their buffers overlap: dist <= tol_i + tol_j.
  // With a constant tolerance, this becomes dist <= 2 * tolerance.
  const threshold = 2 * tolerance;

  // Union-find to get connected components under the distance threshold.
  const parent: Record<string, string> = {};
  const find = (x: string): string => {
    parent[x] = parent[x] ?? x;
    if (parent[x] !== x) parent[x] = find(parent[x]);
    return parent[x];
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  const coordNodes = nodes.filter((n) => coords[n] !== undefined);
  for (let i = 0; i < coordNodes.length; i++) {
    const ni = coordNodes[i];
    for (let j = i + 1; j < coordNodes.length; j++) {
      const nj = coordNodes[j];
      if (distance(ni, nj) <= threshold) {
        union(ni, nj);
      }
    }
  }

  const clustersByRoot: Record<string, string[]> = {};
  for (const n of coordNodes) {
    const r = find(n);
    (clustersByRoot[r] = clustersByRoot[r] ?? []).push(n);
  }
  const clusters = Object.values(clustersByRoot);

  const newG = new MultiDirectedGraph();
  newG.setAttribute("crs", G.getAttribute("crs"));

  const repMap: Record<string, string> = {};
  for (const cluster of clusters) {
    // Deterministic representative to reduce run-to-run variance
    const rep = [...cluster].sort()[0];
    let sx = 0;
    let sy = 0;
    for (const n of cluster) {
      sx += coords[n].x;
      sy += coords[n].y;
      repMap[n] = rep;
    }
    const cx = sx / cluster.length;
    const cy = sy / cluster.length;
    const attrs = G.getNodeAttributes(rep);
    newG.addNode(rep, { ...attrs, x: cx, y: cy, _merged_nodes: cluster });
  }

  // Ensure we don't drop nodes without coordinates: keep them as singletons.
  for (const n of nodes) {
    if (coords[n] !== undefined) continue;
    if (!newG.hasNode(n)) {
      newG.addNode(n, { ...G.getNodeAttributes(n), _merged_nodes: [n] });
    }
    repMap[n] = n;
  }

  G.forEachEdge((edge, attr, u, v) => {
    const u2 = repMap[u] ?? u;
    const v2 = repMap[v] ?? v;
    newG.addEdge(u2, v2, { ...attr });
  });

  return newG;
}

function _is_endpoint(G: MultiDirectedGraph, node: string): boolean {
  const neighbors = new Set([...G.inNeighbors(node), ...G.outNeighbors(node)]);
  const n = neighbors.size;
  const d = G.degree(node);

  // Rule 1: Self-loop
  if (neighbors.has(node)) return true;

  // Rule 2: No incoming or no outgoing
  if (G.inDegree(node) === 0 || G.outDegree(node) === 0) return true;

  // Rule 3: Not exactly 2 neighbors AND degree 2 or 4
  if (!(n === 2 && (d === 2 || d === 4))) return true;

  return false;
}

function _build_path(
  G: MultiDirectedGraph,
  endpoint: string,
  endpoint_successor: string,
  endpoints: Set<string>
): string[] | null {
  const path = [endpoint, endpoint_successor];
  let successor = endpoint_successor;

  // Safety break to prevent infinite loops in malformed graphs
  let count = 0;
  while (count < 10000) {
      count++;
      
      // Find successors of current successor
      const successors = G.outNeighbors(successor);
      
      // Filter out visited nodes to avoid simple cycles immediately
      // But we need to handle the case where we loop back to start (endpoint)
      
      if (endpoints.has(successor)) {
          return path;
      }

      const valid_successors = successors.filter(n => !path.includes(n));
      
      if (valid_successors.length === 1) {
          successor = valid_successors[0];
          path.push(successor);
      } else if (valid_successors.length === 0) {
          if (successors.includes(endpoint)) {
              path.push(endpoint);
              return path;
          }
          return path; // Dead end or similar
      } else {
          // Bifurcation at non-endpoint? Should not happen if _is_endpoint is correct
          // But if it does, we stop here.
          return path;
      }
  }
  return null;
}
