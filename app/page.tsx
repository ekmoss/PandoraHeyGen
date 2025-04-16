"use client";

import dynamic from "next/dynamic";
import { AppConfig, defaultConfig } from "@/app/lib/configTypes";
import { useEffect, useState } from "react";

// Import InteractiveAvatar as a client component with no SSR
const InteractiveAvatar = dynamic(
  () => import("@/components/InteractiveAvatar"),
  { ssr: false }
);

export default function App() {
  const [config, setConfig] = useState<AppConfig>(defaultConfig);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  // Load config from API route instead of direct server function
  useEffect(() => {
    async function loadConfig() {
      try {
        const response = await fetch("/api/get-config");

        if (!response.ok) {
          throw new Error(
            `Config API returned ${response.status}: ${response.statusText}`
          );
        }

        const loadedConfig = await response.json();
        setConfig(loadedConfig);
        setConfigError(null);
      } catch (error) {
        console.error("Failed to load config:", error);
        setConfigError(
          error instanceof Error
            ? error.message
            : "Unknown error loading configuration"
        );
        // Fallback to default config already set
      } finally {
        setConfigLoaded(true);
      }
    }

    loadConfig();
  }, []);

  return (
    <div className="w-screen h-screen overflow-hidden relative bg-deep-purple-950">
      <div className="w-full h-full flex items-center justify-center">
        <div className="w-full h-full max-h-screen">
          {configLoaded ? (
            configError ? (
              <div className="flex items-center justify-center h-full w-full text-white flex-col">
                <div className="text-xl mb-4">Error loading configuration</div>
                <div className="text-red-400">{configError}</div>
              </div>
            ) : (
              <InteractiveAvatar initialConfig={config} />
            )
          ) : (
            <div className="flex items-center justify-center h-full w-full text-white">
              Loading configuration...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
