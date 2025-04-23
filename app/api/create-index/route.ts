import { NextResponse } from "next/server";
import { createSearchIndex } from "@/services/index";

export async function POST() {
  try {
    await createSearchIndex();
    return NextResponse.json({ message: "Search index created successfully." });
  } catch (error: any) {
    console.error("Error creating search index:", error);
    return NextResponse.json({ error: "Failed to create search index" }, { status: 500 });
  }
}