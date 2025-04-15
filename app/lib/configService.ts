/* eslint-disable no-console */
import fs from "fs";
import path from "path";
import { AppConfig, defaultConfig } from "./configTypes";

// Cache the loaded config to avoid excessive file reads
let cachedConfig: AppConfig | null = null;

// Path to the configuration file
const CONFIG_PATH = path.resolve(process.cwd(), "app-config.json");

/**
 * Loads configuration from app-config.json file
 * Falls back to defaultConfig if file cannot be read or parsed
 */
export async function getConfig(): Promise<AppConfig> {
  // Return cached config if available
  if (cachedConfig) {
    return cachedConfig;
  }

  try {
    // Read and parse the JSON file
    const fileData = await fs.promises.readFile(CONFIG_PATH, "utf8");
    const fileConfig = JSON.parse(fileData) as Partial<AppConfig>;

    // Deep merge with defaultConfig to ensure all properties exist
    cachedConfig = deepMerge(defaultConfig, fileConfig) as AppConfig;

    console.log("Configuration loaded successfully from app-config.json");
    return cachedConfig;
  } catch (error) {
    console.warn(
      "Failed to load config from file, using default configuration:",
      error
    );
    return defaultConfig;
  }
}

/**
 * Updates the configuration in the app-config.json file
 * @param updates Partial configuration with the values to update
 * @returns The updated configuration
 */
export async function updateConfig(
  updates: Partial<AppConfig>
): Promise<AppConfig> {
  try {
    // First get the current configuration (either from cache or file)
    const currentConfig = await getConfig();

    // Apply the updates to the current configuration
    const updatedConfig = deepMerge(currentConfig, updates) as AppConfig;

    // Write the updated config back to the file
    await fs.promises.writeFile(
      CONFIG_PATH,
      JSON.stringify(updatedConfig, null, 2),
      "utf8"
    );

    // Update the cached config
    cachedConfig = updatedConfig;

    console.log("Configuration updated and saved to app-config.json");
    return updatedConfig;
  } catch (error) {
    console.error("Failed to update configuration:", error);
    throw new Error("Failed to update configuration");
  }
}

/**
 * Deep merges source object into target object
 * Used to merge loaded config with defaults to ensure all properties exist
 */
function deepMerge(
  target: Record<string, any>,
  source: Record<string, any>
): Record<string, any> {
  const output = { ...target };

  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach((key) => {
      if (isObject(source[key])) {
        if (!(key in target)) {
          output[key] = source[key];
        } else {
          output[key] = deepMerge(target[key], source[key]);
        }
      } else {
        output[key] = source[key];
      }
    });
  }

  return output;
}

/**
 * Helper function to check if value is an object
 */
function isObject(item: any): item is Record<string, any> {
  return item && typeof item === "object" && !Array.isArray(item);
}
