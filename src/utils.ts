import * as fs from "fs";
import * as path from "path";
import { settings } from "./settings";

/**
 * Return current local timestamp as a string.
 */
export function ts(style: "datetime" | "iso8601" | "date" | "time" = "datetime"): string {
  const now = new Date();
  if (style === "iso8601") {
    return now.toISOString();
  } else if (style === "date") {
    return now.toISOString().split("T")[0];
  } else if (style === "time") {
    return now.toTimeString().split(" ")[0];
  } else {
    // datetime: YYYY-MM-DD HH:MM:SS
    return now.toISOString().replace("T", " ").split(".")[0];
  }
}

/**
 * Write a message to the log file and/or print to the console.
 */
export function log(message: string, level: string = "INFO"): void {
  const timestamp = ts();
  const log_message = `[${timestamp}] [${level}] ${message}`;

  if (settings.log_console) {
    console.log(log_message);
  }
  
  if (settings.log_file) {
      try {
          if (!fs.existsSync(settings.logs_folder)) {
              fs.mkdirSync(settings.logs_folder, { recursive: true });
          }
          const logPath = path.join(settings.logs_folder, `${settings.log_filename}.log`);
          fs.appendFileSync(logPath, log_message + "\n");
      } catch (e) {
          console.error("Failed to write to log file:", e);
      }
  }
}

/** Return recommended citation text, reading CITATION.cff if present. */
export function citation(): string {
  const fallback = "Boeing, G. (2017). Tilerama: New methods for acquiring, constructing, analyzing, and visualizing complex street networks. Computers, Environment and Urban Systems, 65, 126-139.";
  const candidates = [
    path.join(process.cwd(), "CITATION.cff"),
    path.join(process.cwd(), "..", "CITATION.cff"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        return fs.readFileSync(p, "utf-8");
      } catch (e) {
        // fall through
      }
    }
  }
  return fallback;
}
