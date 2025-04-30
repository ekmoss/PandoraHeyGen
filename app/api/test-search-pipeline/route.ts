// typescript
// filepath: app/api/test-search-pipeline/route.ts
import { NextResponse, NextRequest } from "next/server";
import { testSearchPipeline } from "@/services/testSearchPipeline";

export async function POST(req: NextRequest) {
  try {
    const { query } = await req.json();

    if (!query) {
      return NextResponse.json({ error: "Missing query parameter" }, { status: 400 });
    }

    const results = await testSearchPipeline(query);

    return NextResponse.json({ results });
  } catch (error: any) {
    console.error("API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}