import axios from "axios";
import { settings } from "./settings";
import { log } from "./utils";

/**
 * Retrieve an OSM element from the Nominatim API.
 */
export async function _download_nominatim_element(
  query: string | Record<string, string>,
  by_osmid: boolean = false,
  limit: number = 1,
  polygon_geojson: boolean = true
): Promise<any[]> {
  const params: Record<string, any> = {};
  params["format"] = "json";
  params["polygon_geojson"] = polygon_geojson ? 1 : 0;

  let request_type = "search";

  if (by_osmid) {
    if (typeof query !== "string") {
      throw new Error("`query` must be a string if `by_osmid` is true.");
    }
    request_type = "lookup";
    params["osm_ids"] = query;
  } else {
    request_type = "search";
    params["dedupe"] = 0;
    params["limit"] = limit;

    if (typeof query === "string") {
      params["q"] = query;
    } else {
      Object.assign(params, query);
    }
  }

  return _nominatim_request(params, request_type);
}

/**
 * Send a HTTP GET request to the Nominatim API and return response.
 */
export async function _nominatim_request(
  params: Record<string, any>,
  request_type: string = "search"
): Promise<any[]> {
  if (settings.nominatim_key) {
    params["key"] = settings.nominatim_key;
  }

  const url = `${settings.nominatim_url.replace(/\/$/, "")}/${request_type}`;
  
  // Pause logic (simple 1s delay)
  // In a real async environment, we might want a queue or rate limiter.
  // For now, we just proceed.
  
  log(`Get ${url} with params ${JSON.stringify(params)}`, "INFO");

  try {
    const response = await axios.get(url, {
      params: params,
      timeout: settings.requests_timeout * 1000,
      headers: {
        "User-Agent": settings.http_user_agent,
        Referer: settings.http_referer,
      },
    });

    if (response.status !== 200) {
      throw new Error(`Nominatim API request failed with status ${response.status}`);
    }

    return response.data as any[];
  } catch (error: any) {
    console.error("Error in _nominatim_request:", error.message);
    throw error;
  }
}
