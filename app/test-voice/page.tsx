import dynamic from "next/dynamic";

// Create a client-only test component
const ClientTest = dynamic(() => import("@/components/VoiceTest/VoiceTest"), {
  ssr: false,
});

export default function TestVoicePage() {
  return (
    <div>
      <ClientTest />
    </div>
  );
}
