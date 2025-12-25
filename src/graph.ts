import { MultiDirectedGraph } from "graphology";
import { settings } from "./settings";
import { overpassRequest, overpassQuery, _download_overpass_network } from "./overpass";
import * as utils from "./utils";
import * as distance from "./distance";
import * as utils_geo from "./utils_geo";
import * as geocoder from "./geocoder";
import * as simplification from "./simplification";
import * as truncate from "./truncate";
import * as utils_graph from "./utils_graph";
import * as turf from "@turf/turf";
import * as fs from "fs";
import { parseStringPromise } from "xml2js";

// Type definitions for OSM elements
interface OSMNode {
  type: "node";
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

interface OSMWay {
  type: "way";
  id: number;
  nodes: number[];
  tags?: Record<string, string>;
}

interface OSMElement extends Record<string, any> {
  type: string;
  id: number;
}

interface OverpassResponse {
  elements: OSMElement[];
}

/**
 * Download and create a graph within a lat-lon bounding box.
 */
export async function graph_from_bbox(
  bbox: [number, number, number, number],
  network_type: string = "all",
  simplify: boolean = true,
  retain_all: boolean = false,
  truncate_by_edge: boolean = false,
  custom_filter: string | string[] | null = null
): Promise<MultiDirectedGraph> {
  const polygon = utils_geo.bbox_to_poly(bbox);

  // Buffer polygon logic (50 meters buffer to ensure boundary nodes are captured)
  // Buffer the bbox slightly.
  // Note: bbox_to_poly returns a Feature<Polygon>, turf.buffer expects Feature or Geometry.
  // We buffer by 0.05 km (50m)
  const buffered_polygon = turf.buffer(polygon, 0.05, { units: 'kilometers' });

  const response_jsons: OverpassResponse[] = [];
  for await (const response of _download_overpass_network(
    buffered_polygon,
    network_type,
    custom_filter
  )) {
    response_jsons.push(response);
  }

  const bidirectional = settings.bidirectional_network_types.includes(network_type);
  let G = _create_graph(response_jsons, bidirectional);

  if (simplify) {
    G = simplification.simplify_graph(G);
  }

  // Truncate graph to bbox
  G = truncate.truncate_graph_bbox(G, bbox, truncate_by_edge, retain_all);

  if (!retain_all) {
    G = utils_graph.get_largest_component(G);
  }

  utils.log(`graph_from_bbox returned graph with ${G.order} nodes and ${G.size} edges`, "INFO");
  return G;
}

/**
 * Create a graph centered on a point within a given distance (meters).
 */
export async function graph_from_point(
  center_point: [number, number],
  dist: number = 1000,
  network_type: string = "all",
  simplify: boolean = true,
  retain_all: boolean = false,
  truncate_by_edge: boolean = false,
  custom_filter: string | string[] | null = null
): Promise<MultiDirectedGraph> {
  const bbox = utils_geo.bbox_from_point(center_point, dist);
  return graph_from_bbox(bbox, network_type, simplify, retain_all, truncate_by_edge, custom_filter);
}

/**
 * Download and create a graph within some distance of an address.
 * 
 * @param address - The address to geocode and use as center point
 * @param dist - Distance in meters
 * @param dist_type - "bbox" or "network" (currently only bbox supported)
 * @param network_type - Type of street network
 * @param simplify - Whether to simplify graph topology
 * @param retain_all - Whether to retain all components
 * @param truncate_by_edge - Whether to truncate by edge
 * @param custom_filter - Custom Overpass filter
 */
export async function graph_from_address(
  address: string,
  dist: number = 1000,
  dist_type: string = "bbox",
  network_type: string = "all",
  simplify: boolean = true,
  retain_all: boolean = false,
  truncate_by_edge: boolean = false,
  custom_filter: string | string[] | null = null
): Promise<MultiDirectedGraph> {
  utils.log(`Geocoding address: "${address}"`, "INFO");
  
  // Geocode the address to get coordinates
  const [lat, lon] = await geocoder.geocode(address);
  const center_point: [number, number] = [lat, lon];
  
  utils.log(`Geocoded to: ${lat}, ${lon}`, "INFO");
  
  // Use graph_from_point with the geocoded coordinates
  return graph_from_point(
    center_point,
    dist,
    network_type,
    simplify,
    retain_all,
    truncate_by_edge,
    custom_filter
  );
}

/**
 * Create a graph from a Polygon or MultiPolygon GeoJSON geometry.
 */
export async function graph_from_polygon(
  polygon: any,
  network_type: string = "all",
  simplify: boolean = true,
  retain_all: boolean = false,
  truncate_by_edge: boolean = false,
  custom_filter: string | string[] | null = null
): Promise<MultiDirectedGraph> {
  const polygons: any[] = [];

  const geom = polygon && polygon.type === "Feature" ? polygon.geometry : polygon;
  if (!geom || !geom.type || !geom.coordinates) {
    throw new Error("graph_from_polygon expects a GeoJSON Polygon or MultiPolygon.");
  }

  if (geom.type === "Polygon") {
    polygons.push(turf.polygon(geom.coordinates));
  } else if (geom.type === "MultiPolygon") {
    for (const coords of geom.coordinates) {
      polygons.push(turf.polygon(coords));
    }
  } else {
    throw new Error(`Unsupported geometry type ${geom.type}; expected Polygon or MultiPolygon.`);
  }

  const response_jsons: any[] = [];
  for (const poly of polygons) {
    for await (const response of _download_overpass_network(poly, network_type, custom_filter)) {
      response_jsons.push(response);
    }
  }

  const bidirectional = settings.bidirectional_network_types.includes(network_type);
  let G = _create_graph(response_jsons, bidirectional);

  if (simplify) {
    G = simplification.simplify_graph(G);
  }

  // Ensure graph stays within polygon boundary
  G = truncate.truncate_graph_polygon(G, polygons.length === 1 ? polygons[0] : turf.multiPolygon(polygons.map(p => p.geometry.coordinates)), retain_all);

  if (!retain_all) {
    G = utils_graph.get_largest_component(G);
  }

  utils.log(`graph_from_polygon returned graph with ${G.order} nodes and ${G.size} edges`, "INFO");
  return G;
}

/**
 * Create a graph from a place name by geocoding to a polygon.
 */
export async function graph_from_place(
  query: string | Record<string, string> | (string | Record<string, string>)[],
  which_result: number | null = 1,
  network_type: string = "all",
  simplify: boolean = true,
  retain_all: boolean = false,
  truncate_by_edge: boolean = false,
  custom_filter: string | string[] | null = null
): Promise<MultiDirectedGraph> {
  const gdf = await geocoder.geocode_to_gdf(query, which_result, false);
  if (!gdf.features || gdf.features.length === 0) {
    throw new Error("geocode_to_gdf returned no features for the provided query.");
  }

  const geometry = gdf.features[0].geometry;
  return graph_from_polygon(geometry, network_type, simplify, retain_all, truncate_by_edge, custom_filter);
}

/**
 * Convert an OSM node element into the format for a graph node.
 */
function _convert_node(element: OSMNode): Record<string, any> {
  const node: Record<string, any> = { y: element.lat, x: element.lon };
  if (element.tags) {
    for (const useful_tag of settings.useful_tags_node) {
      if (useful_tag in element.tags) {
        node[useful_tag] = element.tags[useful_tag];
      }
    }
  }
  return node;
}

/**
 * Convert an OSM way element into the format for a graph path.
 */
function _convert_path(element: OSMWay): Record<string, any> {
  const path: Record<string, any> = { osmid: element.id };

  // remove any consecutive duplicate elements in the list of nodes
  path["nodes"] = element.nodes.filter((item, pos, arr) => {
    return pos === 0 || item !== arr[pos - 1];
  });

  if (element.tags) {
    for (const useful_tag of settings.useful_tags_way) {
      if (useful_tag in element.tags) {
        path[useful_tag] = element.tags[useful_tag];
      }
    }
  }
  return path;
}

/**
 * Construct dicts of nodes and paths from an Overpass response.
 */
function _parse_nodes_paths(
  response_json: OverpassResponse
): [Record<number, any>, Record<number, any>] {
  const nodes: Record<number, any> = {};
  const paths: Record<number, any> = {};

  for (const element of response_json.elements) {
    if (element.type === "node") {
      nodes[element.id] = _convert_node(element as OSMNode);
    } else if (element.type === "way") {
      paths[element.id] = _convert_path(element as OSMWay);
    }
  }

  return [nodes, paths];
}

/**
 * Determine if a path of nodes allows travel in only one direction.
 */
function _is_path_one_way(
  attrs: Record<string, any>,
  bidirectional: boolean,
  oneway_values: Set<string>
): boolean {
  // rule 1
  if (settings.all_oneway) {
    return true;
  }

  // rule 2
  if (bidirectional) {
    return false;
  }

  // rule 3
  if ("oneway" in attrs && oneway_values.has(attrs["oneway"])) {
    return true;
  }

  // rule 4
  if ("junction" in attrs && attrs["junction"] === "roundabout") {
    return true;
  }

  return false;
}

/**
 * Determine if the order of nodes in a path should be reversed.
 */
function _is_path_reversed(
  attrs: Record<string, any>,
  reversed_values: Set<string>
): boolean {
  return "oneway" in attrs && reversed_values.has(attrs["oneway"]);
}

/**
 * Add OSM paths to the graph as edges.
 */
function _add_paths(
  G: MultiDirectedGraph,
  paths: Iterable<Record<string, any>>,
  bidirectional: boolean
): void {
  const oneway_values = new Set(["yes", "true", "1", "-1", "reverse", "T", "F"]);
  const reversed_values = new Set(["-1", "reverse", "T"]);

  for (const path of paths) {
    // extract/remove the ordered list of nodes
    const nodes = path["nodes"] as number[];
    delete path["nodes"];

    const is_one_way = _is_path_one_way(path, bidirectional, oneway_values);
    if (is_one_way && _is_path_reversed(path, reversed_values)) {
      nodes.reverse();
    }

    if (!settings.all_oneway) {
      path["oneway"] = is_one_way;
    }

    // zip path nodes to get (u, v) tuples
    const edges: [number, number][] = [];
    for (let i = 0; i < nodes.length - 1; i++) {
      edges.push([nodes[i], nodes[i + 1]]);
    }

    path["reversed"] = false;
    for (const [u, v] of edges) {
        // Graphology needs string keys for nodes usually, but let's see if it handles numbers.
        // It's safer to convert to string.
        G.addEdge(u.toString(), v.toString(), { ...path });
    }

    if (!is_one_way) {
      path["reversed"] = true;
      for (const [u, v] of edges) {
        G.addEdge(v.toString(), u.toString(), { ...path });
      }
    }
  }
}

/**
 * Create a graph from data in an OSM XML file.
 * 
 * @param filepath - Path to file containing OSM XML data
 * @param bidirectional - If true, create bidirectional edges for one-way streets
 * @param simplify - If true, simplify graph topology
 * @param retain_all - If true, return entire graph even if disconnected
 * @param encoding - File character encoding (default: utf-8)
 * @returns The resulting MultiDiGraph
 */
export async function graph_from_xml(
  filepath: string,
  bidirectional: boolean = false,
  simplify: boolean = true,
  retain_all: boolean = false,
  encoding: string = "utf-8"
): Promise<MultiDirectedGraph> {
  utils.log(`Loading graph from OSM XML file: ${filepath}`, "INFO");
  
  // Read and parse XML file
  const xmlContent = fs.readFileSync(filepath, { encoding: encoding as BufferEncoding });
  const overpassJson = await _overpass_json_from_xml(xmlContent);
  
  // Create graph from JSON
  const response_jsons = [overpassJson];
  let G = _create_graph(response_jsons, bidirectional);
  
  // Keep only largest component if retain_all is false
  if (!retain_all) {
    G = truncate.largest_component(G, false);
  }
  
  // Simplify graph topology
  if (simplify) {
    G = simplification.simplify_graph(G);
  }
  
  utils.log(`graph_from_xml returned graph with ${G.order} nodes and ${G.size} edges`, "INFO");
  return G;
}

/**
 * Convert OSM XML to Overpass-like JSON format.
 * 
 * @param xmlContent - XML string content
 * @returns Overpass-like JSON object
 */
async function _overpass_json_from_xml(xmlContent: string): Promise<OverpassResponse> {
  const result = await parseStringPromise(xmlContent, {
    explicitArray: false,
    mergeAttrs: true
  });
  
  const elements: OSMElement[] = [];
  
  // Parse OSM root element
  const osm = result.osm;
  
  // Process nodes
  if (osm.node) {
    const nodes = Array.isArray(osm.node) ? osm.node : [osm.node];
    for (const node of nodes) {
      const element: any = {
        type: "node",
        id: parseInt(node.id),
        lat: parseFloat(node.lat),
        lon: parseFloat(node.lon),
        tags: {}
      };
      
      // Add optional attributes
      if (node.changeset) element.changeset = parseInt(node.changeset);
      if (node.uid) element.uid = parseInt(node.uid);
      if (node.user) element.user = node.user;
      if (node.version) element.version = parseInt(node.version);
      if (node.timestamp) element.timestamp = node.timestamp;
      
      // Parse tags
      if (node.tag) {
        const tags = Array.isArray(node.tag) ? node.tag : [node.tag];
        for (const tag of tags) {
          element.tags[tag.k] = tag.v;
        }
      }
      
      elements.push(element);
    }
  }
  
  // Process ways
  if (osm.way) {
    const ways = Array.isArray(osm.way) ? osm.way : [osm.way];
    for (const way of ways) {
      const element: any = {
        type: "way",
        id: parseInt(way.id),
        nodes: [],
        tags: {}
      };
      
      // Add optional attributes
      if (way.changeset) element.changeset = parseInt(way.changeset);
      if (way.uid) element.uid = parseInt(way.uid);
      if (way.user) element.user = way.user;
      if (way.version) element.version = parseInt(way.version);
      if (way.timestamp) element.timestamp = way.timestamp;
      
      // Parse node references
      if (way.nd) {
        const nds = Array.isArray(way.nd) ? way.nd : [way.nd];
        for (const nd of nds) {
          element.nodes.push(parseInt(nd.ref));
        }
      }
      
      // Parse tags
      if (way.tag) {
        const tags = Array.isArray(way.tag) ? way.tag : [way.tag];
        for (const tag of tags) {
          element.tags[tag.k] = tag.v;
        }
      }
      
      elements.push(element);
    }
  }
  
  // Process relations (optional, for advanced features)
  if (osm.relation) {
    const relations = Array.isArray(osm.relation) ? osm.relation : [osm.relation];
    for (const relation of relations) {
      const element: any = {
        type: "relation",
        id: parseInt(relation.id),
        members: [],
        tags: {}
      };
      
      // Add optional attributes
      if (relation.changeset) element.changeset = parseInt(relation.changeset);
      if (relation.uid) element.uid = parseInt(relation.uid);
      if (relation.user) element.user = relation.user;
      if (relation.version) element.version = parseInt(relation.version);
      if (relation.timestamp) element.timestamp = relation.timestamp;
      
      // Parse members
      if (relation.member) {
        const members = Array.isArray(relation.member) ? relation.member : [relation.member];
        for (const member of members) {
          element.members.push({
            type: member.type,
            ref: parseInt(member.ref),
            role: member.role || ""
          });
        }
      }
      
      // Parse tags
      if (relation.tag) {
        const tags = Array.isArray(relation.tag) ? relation.tag : [relation.tag];
        for (const tag of tags) {
          element.tags[tag.k] = tag.v;
        }
      }
      
      elements.push(element);
    }
  }
  
  return { elements };
}

/**
 * Create a graph from Overpass JSON responses.
 */
export function _create_graph(
  response_jsons: OverpassResponse[],
  bidirectional: boolean = false
): MultiDirectedGraph {
  const nodes: Record<number, any> = {};
  const paths: Record<number, any> = {};

  for (const response_json of response_jsons) {
    if (!settings.cache_only_mode) {
      const [nodes_temp, paths_temp] = _parse_nodes_paths(response_json);
      Object.assign(nodes, nodes_temp);
      Object.assign(paths, paths_temp);
    }
  }

  if (settings.cache_only_mode) {
      throw new Error("Interrupted because `settings.cache_only_mode=true`.");
  }

  if (Object.keys(nodes).length === 0 && Object.keys(paths).length === 0) {
      throw new Error("No data elements in server response.");
  }

  const G = new MultiDirectedGraph();
  
  // Set graph-level attributes
  G.setAttribute("created_date", new Date().toISOString());
  G.setAttribute("created_with", "Tilerama");
  G.setAttribute("crs", settings.default_crs);

  console.log(`Creating graph from ${Object.keys(nodes).length} OSM nodes and ${Object.keys(paths).length} OSM ways...`);

  // Add nodes
  for (const [id, data] of Object.entries(nodes)) {
      G.addNode(id, data);
  }

  // Add paths
  _add_paths(G, Object.values(paths), bidirectional);

  console.log(`Created graph with ${G.order} nodes and ${G.size} edges`);

  // Add edge lengths
  if (G.size > 0) {
    distance.add_edge_lengths(G);
  }

  return G;
}
