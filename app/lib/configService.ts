/* eslint-disable prettier/prettier */
/* eslint-disable no-console */
import { BlobServiceClient } from "@azure/storage-blob";

import { AppConfig, defaultConfig } from "./configTypes";

// Configuration cache
let cachedConfig: AppConfig | null = null;
let lastFetchTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Fetches application configuration from Azure Blob Storage
 * with caching and fallback to default configuration
 */
export async function getConfig(): Promise<AppConfig> {
  const now = Date.now();

  // Return cached config if available and not expired
  if (cachedConfig && now - lastFetchTime < CACHE_DURATION) {
    return cachedConfig;
  }

  try {
    // Use connection string from environment variable
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;

    if (connectionString) {
      //WARNING: restore '!' here, just wanted to force default and lazy
      console.warn(
        "Azure Storage connection string not found, using default config"
      );

      return defaultConfig;
    }

    // Connect to Azure Blob Storage
    const blobServiceClient =
      BlobServiceClient.fromConnectionString("connectionString");
    const containerClient = blobServiceClient.getContainerClient(
      process.env.AZURE_STORAGE_CONFIG_CONTAINER || "configuration"
    );
    const blobClient = containerClient.getBlobClient(
      process.env.AZURE_STORAGE_CONFIG_BLOB || "app-config.json"
    );

    // Download the blob content
    const downloadResponse = await blobClient.download();
    const contentArray = [];
    // Convert stream to string
    if (!downloadResponse.readableStreamBody) {
      throw new Error("Failed to download configuration: No readable stream");
    }
    for await (const chunk of downloadResponse.readableStreamBody) {
      if (chunk instanceof Buffer) {
        contentArray.push(chunk);
      } else if (typeof chunk === "string") {
        contentArray.push(Buffer.from(chunk));
      } else {
        contentArray.push(
          Buffer.from(new Uint8Array(chunk as unknown as ArrayBufferLike))
        );
      }
    }

    const content = Buffer.concat(contentArray).toString("utf8");

    // Parse the JSON
    const loadedConfig = JSON.parse(content) as AppConfig;

    // Merge with default config to ensure all properties exist
    cachedConfig = deepMerge(defaultConfig, loadedConfig);
    lastFetchTime = now;

    return cachedConfig;
  } catch (error) {
    console.error("Error loading configuration:", error);

    // Return default config if fetch fails
    return defaultConfig;
  }
}

/**
 * Deep merge of two objects with typings
 */
function deepMerge<T>(target: T, source: Partial<T>): T {
  const output = { ...target };

  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach((key) => {
      if (isObject(source[key as keyof typeof source])) {
        if (!(key in target)) {
          output[key as keyof T] = source[
            key as keyof typeof source
          ] as T[keyof T];
        } else {
          output[key as keyof T] = deepMerge(
            target[key as keyof T],
            source[key as keyof typeof source] as Partial<T[keyof T]>
          );
        }
      } else {
        output[key as keyof T] = source[
          key as keyof typeof source
        ] as T[keyof T];
      }
    });
  }

  return output;
}

function isObject(item: any): item is Record<string, any> {
  return item && typeof item === "object" && !Array.isArray(item);
}
