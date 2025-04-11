import { defaultConfig } from "@/app/lib/configTypes";
import dynamic from "next/dynamic";

// Import InteractiveAvatar as a client component with no SSR
const InteractiveAvatar = dynamic(
  () => import("@/components/InteractiveAvatar"),
  { ssr: false }
);

export default function App() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-deep-purple-950">
      <div className="w-full h-full flex items-center justify-center">
        <div className="w-full h-full max-h-screen">
          <InteractiveAvatar initialConfig={defaultConfig} />
        </div>
      </div>
    </div>
  );
}
