import { getConfig } from "@/app/lib/configService";
import { NextResponse } from "next/server";

/**
 * API route to get configuration data
 * Used by client components that need access to configuration
 */
export async function GET() {
  try {
    const config = await getConfig();
    return NextResponse.json(config);
  } catch (error) {
    console.error("Error fetching configuration:", error);
    return NextResponse.json(
      { error: "Failed to load configuration" },
      { status: 500 }
    );
  }
}
