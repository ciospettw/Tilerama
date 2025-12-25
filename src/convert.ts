import { MultiDirectedGraph } from "graphology";
import { FeatureCollection, Feature, Point, LineString } from "geojson";
import * as wellknown from "wellknown";
import { log } from "./utils";

/**
 * Convert graph to GeoJSON FeatureCollections.
 * 
 * @param G - The input graph.
 * @returns An object containing `nodes` and `edges` FeatureCollections.
 */
export function graph_to_geojson(G: MultiDirectedGraph): { nodes: FeatureCollection<Point>, edges: FeatureCollection<LineString> } {
  const nodeFeatures: Feature<Point>[] = [];
  const edgeFeatures: Feature<LineString>[] = [];

  // Nodes
  G.forEachNode((node, attributes) => {
    if (attributes.x !== undefined && attributes.y !== undefined) {
      nodeFeatures.push({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [Number(attributes.x), Number(attributes.y)]
        },
        properties: {
          id: node,
          ...attributes
        }
      });
    }
  });

  // Edges
  G.forEachEdge((edge, attributes, source, target) => {
    const u = G.getNodeAttributes(source);
    const v = G.getNodeAttributes(target);

    if (u.x !== undefined && u.y !== undefined && v.x !== undefined && v.y !== undefined) {
      // If edge has geometry (from simplification), use it.
      let coordinates: number[][] = [];

      if (attributes.geometry) {
          // If geometry is a GeoJSON Geometry object (LineString)
          if (attributes.geometry.type === "LineString" && Array.isArray(attributes.geometry.coordinates)) {
              coordinates = attributes.geometry.coordinates;
          } 
          // If it's WKT (string)
          else if (typeof attributes.geometry === "string") {
              try {
                  const geo = wellknown.parse(attributes.geometry);
                  if (geo && geo.type === "LineString") {
                      coordinates = (geo as LineString).coordinates;
                  }
              } catch (e) {
                  // Ignore parsing errors
              }
          }
          else if (Array.isArray(attributes.geometry)) {
              // Sometimes we might store it as raw array
              coordinates = attributes.geometry;
          }
      }

      // Fallback to straight line
      if (coordinates.length === 0) {
          coordinates = [
            [Number(u.x), Number(u.y)],
            [Number(v.x), Number(v.y)]
          ];
      }

      edgeFeatures.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: coordinates
        },
        properties: {
          id: edge,
          source: source,
          target: target,
          ...attributes
        }
      });
    }
  });

  return {
    nodes: {
      type: "FeatureCollection",
      features: nodeFeatures
    },
    edges: {
      type: "FeatureCollection",
      features: edgeFeatures
    }
  };
}

/**
 * Validate that a graph has the expected structure.
 * Checks:
 * - Graph structure (nodes, edges exist)
 * - Node attributes: x, y coordinates (required), street_count (warning)
 * - Edge attributes: osmid, length (required)
 * - CRS attribute
 * 
 * @param G - Graph to validate
 * @param strict - If true, elevate warnings to errors
 * @throws Error if validation fails
 */
export function validate_graph(G: MultiDirectedGraph, strict: boolean = true): void {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Validate graph structure
  if (G.order === 0) {
    errors.push("G must have at least 1 node.");
  }
  
  if (G.size === 0) {
    errors.push("G must have at least 1 edge.");
  }
  
  // Validate CRS attribute
  const crs = G.getAttribute("crs");
  if (!crs) {
    errors.push("G must have a 'crs' attribute.");
  }
  
  // Validate nodes
  if (G.order > 0) {
    let missingXY = 0;
    let invalidXY = 0;
    let missingStreetCount = 0;
    let nonIntNodeIds = 0;
    
    G.forEachNode((nodeId, attr) => {
      // Check x/y exist
      if (attr.x === undefined || attr.y === undefined) {
        missingXY++;
      }
      // Check x/y are numeric
      else if (typeof attr.x !== 'number' || typeof attr.y !== 'number' || 
               isNaN(attr.x) || isNaN(attr.y)) {
        invalidXY++;
      }
      
      // Check street_count
      if (attr.street_count === undefined) {
        missingStreetCount++;
      }
      
      // Check node ID is integer-like
      if (!Number.isInteger(Number(nodeId))) {
        nonIntNodeIds++;
      }
    });
    
    if (missingXY > 0) {
      errors.push("Nodes must have 'x' and 'y' data attributes.");
    }
    
    if (invalidXY > 0) {
      warnings.push("Node 'x' and 'y' data attributes should be numeric.");
    }
    
    if (missingStreetCount > 0) {
      warnings.push("Nodes should have 'street_count' data attributes.");
    }
    
    if (nonIntNodeIds > 0) {
      warnings.push("Node IDs should be type int.");
    }
  }
  
  // Validate edges
  if (G.size > 0) {
    let missingOsmid = 0;
    let invalidOsmid = 0;
    let missingLength = 0;
    let invalidLength = 0;
    
    G.forEachEdge((edge, attr) => {
      // Check osmid
      if (attr.osmid === undefined) {
        missingOsmid++;
      } else if (typeof attr.osmid !== 'number' && !Array.isArray(attr.osmid)) {
        invalidOsmid++;
      }
      
      // Check length
      if (attr.length === undefined) {
        missingLength++;
      } else if (typeof attr.length !== 'number' || isNaN(attr.length)) {
        invalidLength++;
      }
    });
    
    if (missingOsmid > 0) {
      errors.push("Edges must have 'osmid' data attributes.");
    }
    
    if (invalidOsmid > 0) {
      warnings.push("Edge 'osmid' data attributes should be type int or list[int].");
    }
    
    if (missingLength > 0) {
      errors.push("Edges must have 'length' data attributes.");
    }
    
    if (invalidLength > 0) {
      warnings.push("Edge 'length' data attributes should be numeric.");
    }
  }
  
  // Report results
  if (warnings.length > 0) {
    const warnMsg = warnings.join(" ");
    log(warnMsg, "WARNING");
    if (strict) {
      errors.push(...warnings);
    }
  }
  
  if (errors.length > 0) {
    const errMsg = errors.join(" ");
    log(errMsg, "ERROR");
    throw new Error("Graph validation failed: " + errMsg);
  }
  
  log("Successfully validated graph.", "INFO");
}

/**
 * Validate that node and edge FeatureCollections can be converted to a graph.
 * Checks:
 * - Both inputs are valid FeatureCollections
 * - Nodes have 'x' and 'y' properties (coordinates)
 * - Edges reference valid nodes (u, v properties)
 * - No duplicate IDs
 * 
 * @param nodes - FeatureCollection of nodes
 * @param edges - FeatureCollection of edges
 * @param strict - If true, elevate warnings to errors
 */
export function validate_node_edge_gdfs(
  nodes: FeatureCollection<Point>,
  edges: FeatureCollection<LineString>,
  strict: boolean = true
): void {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Track node IDs so we can validate edges reference existing nodes.
  const nodeIds = new Set<string>();
  
  // Validate nodes FeatureCollection
  if (!nodes || nodes.type !== "FeatureCollection" || !Array.isArray(nodes.features)) {
    errors.push("nodes must be a valid FeatureCollection.");
  } else {
    // Check for duplicate node IDs
    let missingCoords = 0;
    
    for (const feature of nodes.features) {
      const id = String(feature.properties?.id || feature.properties?.osmid || "");
      if (id) {
        if (nodeIds.has(id)) {
          errors.push("nodes must have unique IDs.");
          break;
        }
        nodeIds.add(id);
      }
      
      // Check for x/y properties
      const props = feature.properties || {};
      if (props.x === undefined || props.y === undefined) {
        missingCoords++;
      }
    }
    
    if (missingCoords > 0) {
      warnings.push(`${missingCoords} nodes missing 'x' or 'y' properties.`);
    }
  }
  
  // Validate edges FeatureCollection
  if (!edges || edges.type !== "FeatureCollection" || !Array.isArray(edges.features)) {
    errors.push("edges must be a valid FeatureCollection.");
  } else {
    let missingNodeRefs = 0;
    let invalidNodeRefs = 0;
    
    for (const feature of edges.features) {
      const props = feature.properties || {};
      const u = props.u || props.source;
      const v = props.v || props.target;
      
      if (!u || !v) {
        missingNodeRefs++;
      } else {
        const us = String(u);
        const vs = String(v);
        if (nodeIds.size > 0 && (!nodeIds.has(us) || !nodeIds.has(vs))) {
          invalidNodeRefs++;
        }
      }
    }
    
    if (missingNodeRefs > 0) {
      errors.push(`${missingNodeRefs} edges missing 'u'/'v' or 'source'/'target' properties.`);
    }

    if (invalidNodeRefs > 0) {
      errors.push(`${invalidNodeRefs} edges reference non-existent nodes.`);
    }
  }
  
  // Report results
  if (warnings.length > 0) {
    const warnMsg = warnings.join(" ");
    log(warnMsg, "WARNING");
    if (strict) {
      errors.push(...warnings);
    }
  }
  
  if (errors.length > 0) {
    const errMsg = errors.join(" ");
    log(errMsg, "ERROR");
    throw new Error("FeatureCollection validation failed: " + errMsg);
  }
  
  log("Successfully validated node and edge FeatureCollections.", "INFO");
}

/**
 * Validate that a features FeatureCollection has the expected structure.
 * Features should have element_type (node/way/relation) and osmid properties.
 * 
 * @param features - FeatureCollection to validate
 */
export function validate_features_gdf(features: FeatureCollection): void {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  if (!features || features.type !== "FeatureCollection" || !Array.isArray(features.features)) {
    errors.push("Input must be a valid FeatureCollection.");
  } else {
    const ids = new Set<string>();
    let missingElementType = 0;
    let missingOsmid = 0;
    let invalidGeometry = 0;
    
    for (const feature of features.features) {
      const props = feature.properties || {};
      
      // Check for element_type
      if (!props.element_type) {
        missingElementType++;
      } else {
        // Validate element_type values
        if (!['node', 'way', 'relation'].includes(props.element_type)) {
          warnings.push(`Invalid element_type: ${props.element_type}`);
        }
      }
      
      // Check for osmid
      if (props.osmid === undefined) {
        missingOsmid++;
      }
      
      // Check for unique IDs (combination of element_type and osmid)
      if (props.element_type && props.osmid !== undefined) {
        const id = `${props.element_type}-${props.osmid}`;
        if (ids.has(id)) {
          errors.push("Features must have unique (element_type, osmid) combinations.");
          break;
        }
        ids.add(id);
      }
      
      // Check geometry validity
      if (!feature.geometry || !feature.geometry.type) {
        invalidGeometry++;
      }
    }
    
    if (missingElementType > 0) {
      warnings.push(`${missingElementType} features missing 'element_type' property.`);
    }
    
    if (missingOsmid > 0) {
      warnings.push(`${missingOsmid} features missing 'osmid' property.`);
    }
    
    if (invalidGeometry > 0) {
      errors.push(`${invalidGeometry} features have invalid geometry.`);
    }
  }
  
  // Report results
  if (warnings.length > 0) {
    log(warnings.join(" "), "WARNING");
  }
  
  if (errors.length > 0) {
    const errMsg = errors.join(" ");
    log(errMsg, "ERROR");
    throw new Error("Features validation failed: " + errMsg);
  }
  
  log("Successfully validated features FeatureCollection.", "INFO");
}

/** Convert graph to collections similar to GeoDataFrames. */
export function graph_to_gdfs(
  G: MultiDirectedGraph,
  node_geometry: boolean = true,
  fill_edge_geometry: boolean = true
): { nodes: FeatureCollection<Point>; edges: FeatureCollection<LineString> } {
  return graph_to_geojson(G);
}

/**
 * Build a graph from node and edge FeatureCollections.
 * This is the inverse of graph_to_gdfs/graph_to_geojson.
 * 
 * Node features should have:
 * - geometry: Point with coordinates
 * - properties: x, y (required), osmid or id (for node ID)
 * 
 * Edge features should have:
 * - geometry: LineString
 * - properties: u, v (or source, target), osmid, length, etc.
 * 
 * @param nodes - FeatureCollection of nodes
 * @param edges - FeatureCollection of edges  
 * @param graph_attrs - Optional graph-level attributes (e.g., crs)
 * @returns MultiDirectedGraph
 */
export function graph_from_gdfs(
  nodes: FeatureCollection<Point>,
  edges: FeatureCollection<LineString>,
  graph_attrs?: Record<string, any>
): MultiDirectedGraph {
  const G = new MultiDirectedGraph();
  
  // Set graph-level attributes
  if (graph_attrs) {
    for (const [key, value] of Object.entries(graph_attrs)) {
      G.setAttribute(key, value);
    }
  }
  
  // Add nodes
  for (const f of nodes.features) {
    if (f.geometry?.type === "Point") {
      const [x, y] = f.geometry.coordinates;
      const props = f.properties || {};
      
      // Use osmid or id as node identifier
      const nodeId = String(props.osmid ?? props.id ?? G.order + 1);
      
      // Node attributes: x, y from geometry or properties
      const nodeAttrs: Record<string, any> = {
        x: props.x ?? x,
        y: props.y ?? y,
        ...props
      };
      
      G.addNode(nodeId, nodeAttrs);
    }
  }
  
  // Add edges
  for (const f of edges.features) {
    if (f.geometry?.type === "LineString") {
      const props = f.properties || {};
      
      // Get source and target node IDs
      const u = String(props.u ?? props.source);
      const v = String(props.v ?? props.target);
      
      if (u && v && G.hasNode(u) && G.hasNode(v)) {
        G.addEdge(u, v, { ...props, geometry: f.geometry });
      } else if (u && v) {
        log(`Edge references non-existent nodes: ${u} -> ${v}`, "WARNING");
      }
    }
  }
  
  log(`Created graph with ${G.order} nodes and ${G.size} edges from FeatureCollections.`, "INFO");
  return G;
}

/**
 * Convert MultiDiGraph to DiGraph by removing parallel edges.
 * Keeps the edge with minimum weight attribute value among parallel edges.
 * 
 * @param G - Input MultiDirectedGraph
 * @param weight - Attribute to minimize when choosing between parallel edges
 * @returns A new graph with no parallel edges
 */
export function to_digraph(G: MultiDirectedGraph, weight: string = "length"): MultiDirectedGraph {
  const H = new MultiDirectedGraph();
  
  // Copy nodes
  G.forEachNode((n, attr) => H.addNode(n, { ...attr }));
  
  // Track which edges we've processed
  const processed = new Set<string>();
  
  // For each pair of nodes, keep only the edge with minimum weight
  G.forEachNode((u) => {
    G.forEachOutNeighbor(u, (v) => {
      const pairKey = `${u}-${v}`;
      if (processed.has(pairKey)) return;
      processed.add(pairKey);
      
      const edges = G.edges(u, v);
      
      if (edges.length === 0) return;
      
      if (edges.length === 1) {
        // Only one edge, just copy it
        const attr = G.getEdgeAttributes(edges[0]);
        H.addEdge(u, v, { ...attr });
      } else {
        // Multiple parallel edges, find the one with minimum weight
        let minEdge = edges[0];
        let minWeight = G.getEdgeAttribute(edges[0], weight) || Infinity;
        
        for (let i = 1; i < edges.length; i++) {
          const w = G.getEdgeAttribute(edges[i], weight);
          if (w !== undefined && w < minWeight) {
            minWeight = w;
            minEdge = edges[i];
          }
        }
        
        const attr = G.getEdgeAttributes(minEdge);
        H.addEdge(u, v, { ...attr });
      }
    });
  });
  
  log("Converted MultiDiGraph to DiGraph (removed parallel edges)", "INFO");
  return H;
}

/**
 * Convert MultiDiGraph to undirected MultiGraph.
 * Maintains parallel edges only if their geometries differ.
 * 
 * @param G - Input MultiDirectedGraph
 * @returns An undirected-like graph
 */
export function to_undirected(G: MultiDirectedGraph): MultiDirectedGraph {
  const H = new MultiDirectedGraph();
  
  // Copy nodes
  G.forEachNode((n, attr) => H.addNode(n, { ...attr }));
  
  // Track which edge pairs we've added (bidirectional)
  const addedPairs = new Set<string>();
  
  // First pass: add all edges with from/to metadata and geometries
  G.forEachEdge((edge, attr, u, v) => {
    const edgeData: Record<string, any> = { ...attr, from: u, to: v };
    
    // Add geometry if missing
    if (!edgeData.geometry) {
      const nodeU = G.getNodeAttributes(u);
      const nodeV = G.getNodeAttributes(v);
      if (nodeU.x !== undefined && nodeU.y !== undefined &&
          nodeV.x !== undefined && nodeV.y !== undefined) {
        edgeData.geometry = {
          type: "LineString",
          coordinates: [[nodeU.x, nodeU.y], [nodeV.x, nodeV.y]]
        };
      }
    }
    
    H.addEdge(u, v, edgeData);
  });
  
  // Second pass: ensure bidirectional edges exist
  const edgesToAdd: Array<{u: string, v: string, data: Record<string, any>}> = [];
  
  H.forEachEdge((edge, attr, u, v) => {
    const pairKey = [u, v].sort().join("-");
    
    if (!addedPairs.has(pairKey)) {
      addedPairs.add(pairKey);
      
      // Check if reverse edge exists
      if (!H.hasEdge(v, u)) {
        // Add reverse edge with swapped from/to
        edgesToAdd.push({
          u: v,
          v: u,
          data: { ...attr, from: v, to: u }
        });
      }
    }
  });
  
  // Add all reverse edges
  for (const {u, v, data} of edgesToAdd) {
    H.addEdge(u, v, data);
  }
  
  log("Converted MultiDiGraph to undirected MultiGraph", "INFO");
  return H;
}

/** Helper to compare geometries for similarity */
function areGeometriesSimilar(geom1: any, geom2: any): boolean {
  if (!geom1 || !geom2) return false;
  return JSON.stringify(geom1) === JSON.stringify(geom2);
}
