import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as turf from "@turf/turf";
import { settings } from "./settings";
import { log } from "./utils";

let last_request_time = 0;

/**
 * Send a request to the Overpass API and return the JSON response.
 *
 * @param query - The Overpass query string.
 * @param request_kwargs - Optional keyword arguments to pass to the axios request.
 * @returns The JSON response from the Overpass API.
 */
export async function overpassRequest(
  query: string,
  request_kwargs: any = {}
): Promise<any> {
  // Define the Overpass API URL
  const url = settings.overpass_url + "/interpreter";

  // Check cache
  let cache_path = "";
  if (settings.use_cache) {
    const hash = crypto.createHash("md5").update(url + query).digest("hex");
    if (!fs.existsSync(settings.cache_folder)) {
      fs.mkdirSync(settings.cache_folder, { recursive: true });
    }
    cache_path = path.join(settings.cache_folder, `${hash}.json`);

    if (fs.existsSync(cache_path)) {
      log(`Retrieving response from cache: ${cache_path}`, "INFO");
      const cachedData = fs.readFileSync(cache_path, "utf-8");
      return JSON.parse(cachedData);
    }
  }

  // Prepare the request body
  const data = `data=${encodeURIComponent(query)}`;

  // Prepare headers
  const headers = {
    "User-Agent": settings.http_user_agent,
    Referer: settings.http_referer,
    "Accept-Language": settings.http_accept_language,
    "Content-Type": "application/x-www-form-urlencoded",
    ...request_kwargs.headers,
  };

  // Prepare axios config
  const config = {
    method: "post",
    url: url,
    data: data,
    timeout: settings.requests_timeout * 1000, // axios timeout is in ms
    headers: headers,
    ...request_kwargs,
  };

  try {
    // Rate limiting
    if (settings.overpass_rate_limit) {
      // Simple rate limiting: ensure at least 1 second between requests?
      // Or just check if we need to pause.
      // For now, let's just ensure we don't hammer it.
      const now = Date.now();
      const time_since_last = now - last_request_time;
      // Default to 1 second spacing if not specified, or just rely on server response?
      // We'll just do a simple sleep if requests are too close (e.g. < 1s).
      if (time_since_last < 1000) {
        const sleep_time = 1000 - time_since_last;
        log(`Rate limiting: sleeping for ${sleep_time}ms`, "INFO");
        await new Promise(resolve => setTimeout(resolve, sleep_time));
      }
      last_request_time = Date.now();
    }

    log(`Sending request to ${url} with query: ${query}`, "INFO");
    const response = await axios(config);

    if (response.status !== 200) {
      throw new Error(`Overpass API request failed with status ${response.status}`);
    }

    // Save to cache
    if (settings.use_cache && cache_path) {
      fs.writeFileSync(cache_path, JSON.stringify(response.data));
      log(`Saved response to cache: ${cache_path}`, "INFO");
    }

    return response.data;
  } catch (error: any) {
    console.error("Error in overpassRequest:", error.message);
    throw error;
  }
}

/**
 * Construct an Overpass query string from a dictionary of settings.
 *
 * @param queryBody - The body of the Overpass query.
 * @returns The full Overpass query string.
 */
export function overpassQuery(queryBody: string): string {
  // Default settings for the query
  const timeout = settings.requests_timeout;
  const maxsize = settings.overpass_memory
    ? `[maxsize:${settings.overpass_memory}]`
    : "";

  // Replace placeholders in the settings string
  let querySettings = settings.overpass_settings
    .replace("{timeout}", timeout.toString())
    .replace("{maxsize}", maxsize);

  // Combine settings and body
  // Ensure we don't have double semicolons
  const cleanBody = queryBody.trim().replace(/;$/, "");
  return `${querySettings};${cleanBody};out;`;
}

/**
 * Create a filter to query Overpass for the specified network type.
 */
export function _get_network_filter(network_type: string): string {
  const filters: Record<string, string> = {};

  // driving
  filters["drive"] =
    `["highway"]["area"!~"yes"]${settings.default_access}` +
    `["highway"!~"abandoned|bridleway|bus_guideway|construction|corridor|` +
    `cycleway|elevator|escalator|footway|no|path|pedestrian|planned|platform|` +
    `proposed|raceway|razed|rest_area|service|services|steps|track"]` +
    `["motor_vehicle"!~"no"]["motorcar"!~"no"]` +
    `["service"!~"alley|driveway|emergency_access|parking|parking_aisle|private"]`;

  // drive+service
  filters["drive_service"] =
    `["highway"]["area"!~"yes"]${settings.default_access}` +
    `["highway"!~"abandoned|bridleway|bus_guideway|construction|corridor|` +
    `cycleway|elevator|escalator|footway|no|path|pedestrian|planned|platform|` +
    `proposed|raceway|razed|rest_area|services|steps|track"]` +
    `["motor_vehicle"!~"no"]["motorcar"!~"no"]` +
    `["service"!~"emergency_access|parking|parking_aisle|private"]`;

  // walking
  filters["walk"] =
    `["highway"]["area"!~"yes"]${settings.default_access}` +
    `["highway"!~"abandoned|bus_guideway|construction|cycleway|motor|no|planned|` +
    `platform|proposed|raceway|razed|rest_area|services"]` +
    `["foot"!~"no"]["service"!~"private"]` +
    `["sidewalk"!~"separate"]["sidewalk:both"!~"separate"]` +
    `["sidewalk:left"!~"separate"]["sidewalk:right"!~"separate"]`;

  // biking
  filters["bike"] =
    `["highway"]["area"!~"yes"]${settings.default_access}` +
    `["highway"!~"abandoned|bus_guideway|construction|corridor|elevator|` +
    `escalator|footway|motor|no|planned|platform|proposed|raceway|razed|` +
    `rest_area|services|steps"]` +
    `["bicycle"!~"no"]["service"!~"private"]`;

  // all_public
  filters["all_public"] =
    `["highway"]["area"!~"yes"]${settings.default_access}` +
    `["highway"!~"abandoned|construction|no|planned|platform|proposed|raceway|` +
    `razed|rest_area|services"]` +
    `["service"!~"private"]`;

  // all
  filters["all"] =
    `["highway"]["area"!~"yes"]["highway"!~"abandoned|construction|no|planned|` +
    `platform|proposed|raceway|razed|rest_area|services"]`;

  if (network_type in filters) {
    return filters[network_type];
  } else {
    throw new Error(`Unrecognized network_type ${network_type}.`);
  }
}

/**
 * Retrieve networked ways and nodes within boundary from the Overpass API.
 */
export async function* _download_overpass_network(
  polygon: any, // Turf Polygon
  network_type: string,
  custom_filter: string | string[] | null
): AsyncGenerator<any> {
  let way_filters: string[] = [];
  if (Array.isArray(custom_filter)) {
    way_filters = custom_filter;
  } else if (typeof custom_filter === "string") {
    way_filters = [custom_filter];
  } else {
    way_filters = [_get_network_filter(network_type)];
  }

  // Convert polygon to Overpass coord string
  // Turf polygon coordinates are [[[lon, lat], ...]]
  // Overpass expects "lat lon lat lon ..."
  const coords = polygon.geometry.coordinates[0];
  const coordList: string[] = [];
  for (const [lon, lat] of coords) {
    coordList.push(`${lat.toFixed(6)} ${lon.toFixed(6)}`);
  }
  const polygon_coord_str = coordList.join(" ");

  // NOTE: Subdivision logic for large areas is not fully implemented.
  // We warn the user if the area is too large.
  const area = turf.area(polygon);
  if (area > settings.max_query_area_size) {
      log(`Query area ${area} exceeds max_query_area_size ${settings.max_query_area_size}. Request may fail.`, "WARNING");
  }

  for (const way_filter of way_filters) {
    const query_str = `(way${way_filter}(poly:"${polygon_coord_str}");>;);`;
    const full_query = overpassQuery(query_str);
    const response = await overpassRequest(full_query);
    yield response;
  }
}
