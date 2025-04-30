import { NextRequest, NextResponse } from "next/server";
import { retrieveRelevantDocuments } from "@/services/openai-service";

export async function POST(req: NextRequest) {
  try {
    const { query, maxDocuments, minScore } = await req.json();

    if (!query) {
      return NextResponse.json({ error: "Query is required" }, { status: 400 });
    }

    const { documents, metrics } = await retrieveRelevantDocuments(query, {
      maxDocuments: maxDocuments || 5,
      minScore: minScore || 0
    });

    return NextResponse.json({ documents, metrics });
  } catch (error) {
    console.error("Document Retrieval Error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve documents" },
      { status: 500 }
    );
  }
}