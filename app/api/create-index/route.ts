import { NextResponse } from "next/server";
import { createSearchIndex } from "@/services/index";
import { createRagIndexer } from "@/services/indexer";
import { createRagSkillset } from "@/services/skillset";

export async function POST() {
  try {
    await createSearchIndex();
    await createRagSkillset();
    await createRagIndexer();
    return NextResponse.json({ message: "Search index and indexer created successfully." });
  } catch (error: any) {
    console.error("Error creating search index or indexer:", error);
    return NextResponse.json({ error: "Failed to create search index or indexer" }, { status: 500 });
  }
}


