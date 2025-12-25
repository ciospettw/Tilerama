import { MultiDirectedGraph } from "graphology";
import { log } from "./utils";

/**
 * Return the largest weakly connected component of the graph.
 * 
 * @param G - The graph.
 * @returns A copy of the graph containing only the largest component.
 */
export function get_largest_component(
  G: MultiDirectedGraph,
  strongly: boolean = false
): MultiDirectedGraph {
  if (G.order === 0) return G;

  const components = strongly
    ? stronglyConnectedComponents(G)
    : weaklyConnectedComponents(G);

  if (components.length === 0) return G;

  // Find the largest component by number of nodes
  let largestComponent = components[0];
  for (let i = 1; i < components.length; i++) {
    if (components[i].length > largestComponent.length) {
      largestComponent = components[i];
    }
  }

  log(
    `Graph has ${components.length} ${strongly ? "strongly" : "weakly"} connected components. Largest has ${largestComponent.length} nodes.`,
    "INFO"
  );

  // Create a subgraph with only the nodes in the largest component
  const H = G.copy();
  const nodesToKeep = new Set(largestComponent);
  
  H.forEachNode((node) => {
    if (!nodesToKeep.has(node)) {
      H.dropNode(node);
    }
  });

  return H;
}

/**
 * Find weakly connected components in a directed graph.
 * Treats all edges as undirected for the purpose of finding components.
 */
function weaklyConnectedComponents(G: MultiDirectedGraph): string[][] {
  const visited = new Set<string>();
  const components: string[][] = [];

  G.forEachNode((node) => {
    if (!visited.has(node)) {
      const component: string[] = [];
      const stack: string[] = [node];
      visited.add(node);

      while (stack.length > 0) {
        const current = stack.pop()!;
        component.push(current);

        // Get neighbors (both in and out)
        // In Graphology, `neighbors` returns both in and out neighbors for directed graphs
        G.forEachNeighbor(current, (neighbor) => {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            stack.push(neighbor);
          }
        });
      }
      components.push(component);
    }
  });

  return components;
}

/**
 * Find strongly connected components in a directed graph using Tarjan's algorithm.
 */
function stronglyConnectedComponents(G: MultiDirectedGraph): string[][] {
  const indexMap: Record<string, number> = {};
  const lowLink: Record<string, number> = {};
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let index = 0;

  const successors = (node: string): string[] => {
    const neigh: string[] = [];
    G.forEachOutNeighbor(node, (n) => neigh.push(n));
    return neigh;
  };

  const strongConnect = (v: string) => {
    indexMap[v] = index;
    lowLink[v] = index;
    index += 1;
    stack.push(v);
    onStack.add(v);

    for (const w of successors(v)) {
      if (indexMap[w] === undefined) {
        strongConnect(w);
        lowLink[v] = Math.min(lowLink[v], lowLink[w]);
      } else if (onStack.has(w)) {
        lowLink[v] = Math.min(lowLink[v], indexMap[w]);
      }
    }

    if (lowLink[v] === indexMap[v]) {
      const component: string[] = [];
      while (true) {
        const w = stack.pop();
        if (w === undefined) break;
        onStack.delete(w);
        component.push(w);
        if (w === v) break;
      }
      components.push(component);
    }
  };

  G.forEachNode((node) => {
    if (indexMap[node] === undefined) strongConnect(node);
  });

  return components;
}
