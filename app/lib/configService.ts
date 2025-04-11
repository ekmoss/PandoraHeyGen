/* eslint-disable no-console */
import { AppConfig, defaultConfig } from "./configTypes";

export async function getConfig(): Promise<AppConfig> {
  return defaultConfig;
}
