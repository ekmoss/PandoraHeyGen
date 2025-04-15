import dynamic from "next/dynamic";
import { getConfig } from "@/app/lib/configService";
import { AppConfig, defaultConfig } from "@/app/lib/configTypes";
import { useEffect, useState } from "react";

// Import InteractiveAvatar as a client component with no SSR
const InteractiveAvatar = dynamic(
  () => import("@/components/InteractiveAvatar"),
  { ssr: false }
);

export default function App() {
  // In a server component, we need to provide a default while loading
  // Client-side useEffect will handle loading the config
  const [config, setConfig] = useState<AppConfig>(defaultConfig);
  const [configLoaded, setConfigLoaded] = useState(false);

  // Load config on the client side
  useEffect(() => {
    async function loadConfig() {
      try {
        const loadedConfig = await getConfig();
        setConfig(loadedConfig);
      } catch (error) {
        console.error("Failed to load config:", error);
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
            <InteractiveAvatar initialConfig={config} />
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
