import { NextResponse } from "next/server";

export async function GET() {
  try {
    // Return the token and region
    return NextResponse.json({
      token: process.env.AZURE_SPEECH_KEY,
      region: process.env.AZURE_SPEECH_REGION,
    });
  } catch (error) {
    console.error("Error getting speech token:", error);
    return NextResponse.json(
      { error: "Failed to get speech token" },
      { status: 500 }
    );
  }
}
