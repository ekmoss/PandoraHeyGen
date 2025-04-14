import dynamic from "next/dynamic";

// Create a client-only test component
const StreamingVoiceTest = dynamic(
  () => import("@/components/VoiceTest/StreamingVoiceTest"),
  {
    ssr: false,
  }
);

export default function TestStreamingPage() {
  return (
    <div>
      <StreamingVoiceTest />
    </div>
  );
}
