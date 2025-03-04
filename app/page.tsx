"use client";

import InteractiveAvatar from "@/components/InteractiveAvatar";
export default function App() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-deep-purple-950">
      {/* Background image will be handled in the InteractiveAvatar component */}
      <div className="w-full h-full flex items-center justify-center">
        <div className="w-full h-full max-h-screen">
          <InteractiveAvatar />
        </div>
      </div>
    </div>
  );
}
