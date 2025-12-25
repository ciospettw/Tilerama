import { MultiDirectedGraph } from "graphology";
import axios from "axios";
import { settings } from "./settings";
import { log } from "./utils";

/**
 * Add elevation to the graph nodes using the Google Maps Elevation API or OpenTopoData.
 * 
 * @param G - The graph.
 * @param api_key - Google Maps API key. If null, tries to use OpenTopoData (free, rate limited).
 * @param max_locations_per_batch - Max locations per request.
 */
export async function add_node_elevations(
  G: MultiDirectedGraph,
  api_key: string | null = null,
  max_locations_per_batch: number = 100 // OpenTopoData limit is often 100
): Promise<MultiDirectedGraph> {
  const nodes = G.nodes();
  const batches = [];
  
  for (let i = 0; i < nodes.length; i += max_locations_per_batch) {
    batches.push(nodes.slice(i, i + max_locations_per_batch));
  }

  log(`Requesting elevations for ${nodes.length} nodes in ${batches.length} batches...`, "INFO");

  for (const batch of batches) {
    const locations = batch.map(node => {
      const attrs = G.getNodeAttributes(node);
      return `${attrs.y},${attrs.x}`; // lat,lon
    }).join("|");

    let url = "";
    if (api_key) {
      url = settings.elevation_url_template
        .replace("{locations}", locations)
        .replace("{key}", api_key);
    } else {
      url = `https://api.opentopodata.org/v1/srtm30m?locations=${locations}`;
    }

    try {
      // Rate limiting for OpenTopoData (1 request per second)
      if (!api_key) {
          await new Promise(resolve => setTimeout(resolve, 1000));
      }

      const response = await axios.get(url);
      const data = response.data as any;
      const results = data.results;

      if (!results || results.length !== batch.length) {
        log(`Error fetching elevations: received ${results ? results.length : 0} results for ${batch.length} nodes.`, "ERROR");
        continue;
      }

      results.forEach((result: any, index: number) => {
        const node = batch[index];
        G.setNodeAttribute(node, "elevation", result.elevation);
        G.setNodeAttribute(node, "elevation_grade", 0); // Placeholder for grade calculation
      });

    } catch (error: any) {
      log(`Error fetching elevations: ${error.message}`, "ERROR");
    }
  }

  log("Added elevation data to nodes.", "INFO");
  return G;
}

/**
 * Calculate edge grades (slope) from node elevations.
 * Requires 'elevation' attribute on nodes and 'length' attribute on edges.
 */
export function add_edge_grades(G: MultiDirectedGraph): MultiDirectedGraph {
    G.forEachEdge((edge, attributes, source, target) => {
        const u = G.getNodeAttributes(source);
        const v = G.getNodeAttributes(target);

        if (u.elevation !== undefined && v.elevation !== undefined && attributes.length) {
            const rise = v.elevation - u.elevation;
            const run = attributes.length;
            const grade = rise / run;
            G.setEdgeAttribute(edge, "grade", grade);
            G.setEdgeAttribute(edge, "grade_abs", Math.abs(grade));
        }
    });
    
    log("Added grade attributes to edges.", "INFO");
    return G;
}

/**
 * Add elevation to the graph nodes using the Google Maps Elevation API specifically.
 * This is a convenience wrapper around add_node_elevations with api_key required.
 * 
 * @param G - The graph.
 * @param api_key - Google Maps API key (required).
 * @param max_locations_per_batch - Max locations per request (default 512 for Google).
 */
export async function add_node_elevations_google(
  G: MultiDirectedGraph,
  api_key: string,
  max_locations_per_batch: number = 512
): Promise<MultiDirectedGraph> {
  if (!api_key) {
    throw new Error("Google Maps API key is required for add_node_elevations_google.");
  }
  return add_node_elevations(G, api_key, max_locations_per_batch);
}

/** 
 * Placeholder for raster-based elevations (GDAL-like). 
 * 
 * This would use rasterio/GDAL to sample elevation from DEM files.
 * Node.js doesn't have native GDAL bindings that are easy to use, so this is
 * intentionally left unimplemented. Consider using Python's rasterio or
 * a web service like OpenTopoData instead.
 * 
 * @param G - The graph.
 * @param raster_paths - Path(s) to raster DEM file(s).
 * @returns Graph unchanged with warning logged.
 */
export async function add_node_elevations_raster(
  G: MultiDirectedGraph,
  raster_paths: string | string[]
): Promise<MultiDirectedGraph> {
  log(
    "add_node_elevations_raster is not implemented in Node.js port. " +
    "GDAL/rasterio are not available in Node.js ecosystem. " +
    "Use add_node_elevations with OpenTopoData or Google API instead, " +
    "or process DEMs with Python's rasterio before importing to Node.js.",
    "WARNING"
  );
  return G;
}
