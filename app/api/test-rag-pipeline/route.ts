import { NextRequest, NextResponse } from "next/server";
import { completeRAGPipeline } from "@/services/testSearchPipeline";

export async function POST(req: NextRequest) {
  try {
    const { query } = await req.json();

    if (!query) {
      return NextResponse.json({ error: "Query is required" }, { status: 400 });
    }

    const { answer, sources } = await completeRAGPipeline(query);

    return NextResponse.json({
      answer,
      sources,
    });

  } catch (error) {
    console.error("RAG API Error:", error);
    return NextResponse.json(
      { error: "Failed to process RAG pipeline" },
      { status: 500 }
    );
  }
}