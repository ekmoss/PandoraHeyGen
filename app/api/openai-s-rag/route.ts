import { NextRequest, NextResponse } from "next/server";
import { processUserMessage } from "@/services/openai-service";

export async function POST(req: NextRequest) {
  try {
    const { query, maxDocuments, temperature } = await req.json();

    if (!query) {
      return NextResponse.json({ error: "Query is required" }, { status: 400 });
    }

    const response = await processUserMessage(query, {
      useRAG: true,
      ragMaxDocuments: maxDocuments || 3,
      temperature: temperature || 0.7,
      stream: false
    });

    const result = await response.json();

    return NextResponse.json(result);
  } catch (error) {
    console.error("RAG Pipeline Error:", error);
    return NextResponse.json(
      { error: "Failed to process RAG pipeline" },
      { status: 500 }
    );
  }
}