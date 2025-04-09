import { getConfig } from "@/app/lib/configService";
import InteractiveAvatar from "@/components/InteractiveAvatar";

export default async function App() {
  // Fetch config in server component (server-side)
  const config = await getConfig();

  return (
    <div className="w-screen h-screen overflow-hidden relative bg-deep-purple-950">
      {/* Background image will be handled in the InteractiveAvatar component */}
      <div className="w-full h-full flex items-center justify-center">
        <div className="w-full h-full max-h-screen">
          <InteractiveAvatar initialConfig={config} />
        </div>
      </div>
    </div>
  );
}
