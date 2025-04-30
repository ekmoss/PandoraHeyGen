import { NextResponse } from "next/server";
import { prewarmConnection } from "@/services/openai-service";

export async function POST() {
  try {
    await prewarmConnection();
    return NextResponse.json({ status: "Connection prewarmed successfully" });
  } catch (error) {
    console.error("Prewarm Error:", error);
    return NextResponse.json(
      { error: "Failed to prewarm connection" },
      { status: 500 }
    );
  }
}