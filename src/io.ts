import { MultiDirectedGraph } from "graphology";
import * as fs from "fs";
import * as path from "path";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import graphml from "graphology-graphml";
import { log } from "./utils";
import wellknown from "wellknown";
import { graph_to_geojson } from "./convert";

global.DOMParser = DOMParser;
global.XMLSerializer = XMLSerializer;

/**
 * Save graph to disk as GraphML file.
 *
 * @param G - The graph to save
 * @param filepath - Path to the saved file.
 * @param gephi - If true, give each edge a unique key/id to satisfy Gephi's requirement.
 * @param encoding - The character encoding for the saved file.
 */
export function save_graphml(
  G: MultiDirectedGraph,
  filepath: string,
  gephi: boolean = false,
  encoding: string = "utf-8"
): void {
  const G_save = G.copy();

  if (gephi) {
    G_save.forEachEdge((edge, attributes) => {
      G_save.setEdgeAttribute(edge, "id", edge);
    });
  }

  // Stringify all graph attribute values
  G_save.updateAttributes((attributes) => {
    const newAttributes: any = {};
    for (const [key, value] of Object.entries(attributes)) {
      newAttributes[key] = stringifyValue(value);
    }
    return newAttributes;
  });

  // Stringify all node attribute values
  G_save.forEachNode((node, attributes) => {
    for (const [key, value] of Object.entries(attributes)) {
      G_save.setNodeAttribute(node, key, stringifyValue(value));
    }
  });

  // Stringify all edge attribute values
  G_save.forEachEdge((edge, attributes) => {
    for (const [key, value] of Object.entries(attributes)) {
      G_save.setEdgeAttribute(edge, key, stringifyValue(value));
    }
  });

  // Generate GraphML string
  const xmlString = writeGraphML(G_save);

  // Write to file
  // Ensure directory exists
  const dir = path.dirname(filepath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filepath, xmlString, { encoding: encoding as BufferEncoding });

  log(`Saved graph as GraphML file at ${filepath}`);
}

/**
 * Lightweight GeoPackage placeholder: writes nodes/edges to GeoJSON sidecars.
 */
export function save_graph_geopackage(
  G: MultiDirectedGraph,
  filepath: string
): void {
  const parsed = path.parse(filepath);
  const dir = parsed.dir || ".";
  const stem = path.join(dir, parsed.name);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const { nodes, edges } = graph_to_geojson(G);
  const nodesPath = `${stem}_nodes.geojson`;
  const edgesPath = `${stem}_edges.geojson`;
  fs.writeFileSync(nodesPath, JSON.stringify(nodes));
  fs.writeFileSync(edgesPath, JSON.stringify(edges));
  log(`GeoPackage not implemented; wrote GeoJSON layers instead at ${nodesPath} and ${edgesPath}`, "WARNING");
}

/** Wrapper to save GraphML under .xml/.graphml filename. */
export function save_graph_xml(
  G: MultiDirectedGraph,
  filepath: string,
  gephi: boolean = false,
  encoding: string = "utf-8"
): void {
  const target = filepath.endsWith(".graphml") || filepath.endsWith(".xml")
    ? filepath
    : `${filepath}.graphml`;
  save_graphml(G, target, gephi, encoding);
}

function writeGraphML(G: MultiDirectedGraph): string {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<graphml xmlns="http://graphml.graphdrawing.org/xmlns" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://graphml.graphdrawing.org/xmlns http://graphml.graphdrawing.org/xmlns/1.0/graphml.xsd">\n';

  // Collect all attribute keys
  const nodeKeys = new Set<string>();
  const edgeKeys = new Set<string>();
  const graphKeys = new Set<string>();

  G.forEachNode((node, attributes) => {
    Object.keys(attributes).forEach(k => nodeKeys.add(k));
  });
  G.forEachEdge((edge, attributes) => {
    Object.keys(attributes).forEach(k => edgeKeys.add(k));
  });
  Object.keys(G.getAttributes()).forEach(k => graphKeys.add(k));

  // Write keys
  // We assume everything is string because we stringified it before calling this
  nodeKeys.forEach(key => {
    xml += `  <key id="d_n_${key}" for="node" attr.name="${key}" attr.type="string"/>\n`;
  });
  edgeKeys.forEach(key => {
    xml += `  <key id="d_e_${key}" for="edge" attr.name="${key}" attr.type="string"/>\n`;
  });
  graphKeys.forEach(key => {
    xml += `  <key id="d_g_${key}" for="graph" attr.name="${key}" attr.type="string"/>\n`;
  });

  xml += '  <graph id="G" edgedefault="directed">\n';

  // Graph attributes
  const graphAttrs = G.getAttributes();
  Object.entries(graphAttrs).forEach(([key, value]) => {
    if (graphKeys.has(key)) {
        xml += `    <data key="d_g_${key}">${escapeXML(String(value))}</data>\n`;
    }
  });

  // Nodes
  G.forEachNode((node, attributes) => {
    xml += `    <node id="${escapeXML(node)}">\n`;
    Object.entries(attributes).forEach(([key, value]) => {
      xml += `      <data key="d_n_${key}">${escapeXML(String(value))}</data>\n`;
    });
    xml += '    </node>\n';
  });

  // Edges
  G.forEachEdge((edge, attributes, source, target) => {
    // Graphology edges have keys. We can use them as id.
    xml += `    <edge source="${escapeXML(source)}" target="${escapeXML(target)}" id="${escapeXML(edge)}">\n`;
    Object.entries(attributes).forEach(([key, value]) => {
      xml += `      <data key="d_e_${key}">${escapeXML(String(value))}</data>\n`;
    });
    xml += '    </edge>\n';
  });

  xml += '  </graph>\n';
  xml += '</graphml>';

  return xml;
}

function escapeXML(str: string): string {
  return str.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

/**
 * Load a Tilerama-saved GraphML file from disk.
 *
 * @param filepath - Path to the GraphML file.
 * @param node_dtypes - Dict of node attribute names:types to convert values' data types.
 * @param edge_dtypes - Dict of edge attribute names:types to convert values' data types.
 * @param graph_dtypes - Dict of graph-level attribute names:types to convert values' data types.
 */
export function load_graphml(
  filepath: string,
  node_dtypes?: { [key: string]: (val: string) => any },
  edge_dtypes?: { [key: string]: (val: string) => any },
  graph_dtypes?: { [key: string]: (val: string) => any }
): MultiDirectedGraph {
  if (!fs.existsSync(filepath)) {
    throw new Error(`File not found: ${filepath}`);
  }

  const xmlString = fs.readFileSync(filepath, "utf-8");

  // Parse GraphML
  // We use MultiDirectedGraph as the target class
  const G = graphml.parse(MultiDirectedGraph, xmlString);

  // Default dtypes
  const default_graph_dtypes: { [key: string]: (val: string) => any } = {
    consolidated: _convert_bool_string,
    simplified: _convert_bool_string,
  };

  const default_node_dtypes: { [key: string]: (val: string) => any } = {
    elevation: parseFloat,
    elevation_res: parseFloat,
    osmid: (val) => parseInt(val, 10),
    street_count: (val) => parseInt(val, 10),
    x: parseFloat,
    y: parseFloat,
  };

  const default_edge_dtypes: { [key: string]: (val: string) => any } = {
    bearing: parseFloat,
    grade: parseFloat,
    grade_abs: parseFloat,
    length: parseFloat,
    oneway: _convert_bool_string,
    osmid: (val) => parseInt(val, 10),
    reversed: _convert_bool_string,
    speed_kph: parseFloat,
    travel_time: parseFloat,
  };

  // Merge user dtypes
  const final_graph_dtypes = { ...default_graph_dtypes, ...graph_dtypes };
  const final_node_dtypes = { ...default_node_dtypes, ...node_dtypes };
  const final_edge_dtypes = { ...default_edge_dtypes, ...edge_dtypes };

  log("Converting node, edge, and graph-level attribute data types");

  _convert_graph_attr_types(G, final_graph_dtypes);
  _convert_node_attr_types(G, final_node_dtypes);
  _convert_edge_attr_types(G, final_edge_dtypes);

  log(`Loaded graph with ${G.order} nodes and ${G.size} edges from ${filepath}`);

  return G;
}

function _convert_graph_attr_types(
  G: MultiDirectedGraph,
  dtypes: { [key: string]: (val: string) => any }
): void {
  // Remove node_default and edge_default metadata keys if they exist
  G.removeAttribute("node_default");
  G.removeAttribute("edge_default");

  G.updateAttributes((attributes) => {
    const newAttributes: any = { ...attributes };
    for (const key of Object.keys(newAttributes)) {
      if (key in dtypes) {
        try {
          newAttributes[key] = dtypes[key](newAttributes[key]);
        } catch (e) {
          // Keep original if conversion fails
        }
      }
    }
    return newAttributes;
  });
}

function _convert_node_attr_types(
  G: MultiDirectedGraph,
  dtypes: { [key: string]: (val: string) => any }
): void {
  G.forEachNode((node, attributes) => {
    const newAttributes: any = { ...attributes };

    // First, try to parse stringified lists/dicts/sets
    for (const [key, value] of Object.entries(newAttributes)) {
      if (typeof value === "string") {
        if (
          (value.startsWith("[") && value.endsWith("]")) ||
          (value.startsWith("{") && value.endsWith("}"))
        ) {
          try {
            let jsonStr = value.replace(/'/g, '"');
            jsonStr = jsonStr.replace(/True/g, "true").replace(/False/g, "false").replace(/None/g, "null");
            newAttributes[key] = JSON.parse(jsonStr);
          } catch (e) {
            // Ignore syntax errors
          }
        }
      }
    }

    // Convert types based on dtypes
    for (const key of Object.keys(newAttributes)) {
      if (key in dtypes) {
        try {
          newAttributes[key] = dtypes[key](newAttributes[key]);
        } catch (e) {
          // Keep original
        }
      }
    }

    // Update node attributes
    // We can't replace all at once easily in iteration, so we set them one by one or use replaceAttributes if available (not in forEach)
    // But we can just set them.
    for (const [key, val] of Object.entries(newAttributes)) {
      G.setNodeAttribute(node, key, val);
    }
  });
}

function _convert_edge_attr_types(
  G: MultiDirectedGraph,
  dtypes: { [key: string]: (val: string) => any }
): void {
  G.forEachEdge((edge, attributes) => {
    const newAttributes: any = { ...attributes };
    if (newAttributes.id === edge) {
        delete newAttributes.id;
    }

    for (const [key, value] of Object.entries(newAttributes)) {
      if (typeof value === "string") {
        if (
          (value.startsWith("[") && value.endsWith("]")) ||
          (value.startsWith("{") && value.endsWith("}"))
        ) {
          try {
            let jsonStr = value.replace(/'/g, '"');
            jsonStr = jsonStr.replace(/True/g, "true").replace(/False/g, "false").replace(/None/g, "null");
            newAttributes[key] = JSON.parse(jsonStr);
          } catch (e) {
            // Ignore
          }
        }
      }
    }

    // Convert types
    for (const key of Object.keys(newAttributes)) {
      if (key in dtypes) {
        const val = newAttributes[key];
        if (Array.isArray(val)) {
             newAttributes[key] = val.map(item => dtypes[key](String(item)));
        } else {
             newAttributes[key] = dtypes[key](val);
        }
      }
    }

    // Geometry handling (WKT)
    // If "geometry" attr exists, convert its well-known text to LineString (GeoJSON)
    if (newAttributes.geometry && typeof newAttributes.geometry === "string") {
        try {
            const geojson = wellknown.parse(newAttributes.geometry);
            if (geojson) {
                newAttributes.geometry = geojson;
            }
        } catch (e) {
            // Ignore parsing errors
        }
    }

    // Update edge attributes
    for (const [key, val] of Object.entries(newAttributes)) {
        // If we deleted 'id', we should unset it.
        if (key === 'id' && !('id' in newAttributes)) {
            G.removeEdgeAttribute(edge, 'id');
        } else {
            G.setEdgeAttribute(edge, key, val);
        }
    }
  });
}

export function _convert_bool_string(value: boolean | string): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "True" || value === "true") return true;
  if (value === "False" || value === "false") return false;
  throw new Error(`Invalid literal for boolean: ${value}`);
}

function stringifyValue(value: any): string {
  if (typeof value === 'boolean') {
      return value ? "True" : "False";
  }
  if (typeof value === 'object' && value !== null) {
      return JSON.stringify(value);
  }
  return String(value);
}

