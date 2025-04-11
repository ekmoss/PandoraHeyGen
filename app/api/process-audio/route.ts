import { NextResponse } from "next/server";
import { defaultConfig } from "@/app/lib/configTypes";

export async function POST(request: Request) {
  try {
    // Get the audio blob from the request
    const audioBlob = await request.blob();

    // Create form data to send to HeyGen
    const formData = new FormData();
    formData.append("audio", audioBlob);

    // Send to HeyGen's API
    const response = await fetch(
      `${defaultConfig.apiUrl}/streaming/speech-to-text`,
      {
        method: "POST",
        headers: {
          "X-Api-Key": process.env.HEYGEN_API_KEY || "",
        },
        body: formData,
      }
    );

    if (!response.ok) {
      throw new Error(`HeyGen API error: ${response.statusText}`);
    }

    const data = await response.json();

    return NextResponse.json({
      text: data.text || "",
    });
  } catch (error) {
    console.error("Error processing audio:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
