import { NextRequest, NextResponse } from "next/server";
import { SearchClient, AzureKeyCredential } from "@azure/search-documents";

const AZURE_SEARCH_SERVICE = process.env.AZURE_SEARCH_SERVICE!;
const AZURE_SEARCH_API_KEY = process.env.AZURE_SEARCH_API_KEY!;
const INDEX_NAME = "ts-rag-tutorial-idx";

export async function POST(request: NextRequest) {
  try {
    const { query, kNearestNeighbors, fields } = await request.json();

    if (!query || !kNearestNeighbors || !fields) {
      return NextResponse.json(
        { error: "Missing required fields: query, kNearestNeighbors, or fields" },
        { status: 400 }
      );
    }

    const searchClient = new SearchClient(
      AZURE_SEARCH_SERVICE,
      INDEX_NAME,
      new AzureKeyCredential(AZURE_SEARCH_API_KEY)
    );

    const vectorQuery = {
      text: query,
      kNearestNeighbors,
      fields,
    };

    const results = await searchClient.search("", {
      vectorQueries: [vectorQuery],
      select: ["chunk"],
      top: 1,
    });

    const formattedResults = [];
    for await (const result of results.results) {
      formattedResults.push({
        score: result["@search.score"],
        chunk: result["chunk"],
      });
    }

    return NextResponse.json({ results: formattedResults });
  } catch (error) {
    console.error("Error in vector search:", error);
    return NextResponse.json(
      { error: "Failed to perform vector search" },
      { status: 500 }
    );
  }
}