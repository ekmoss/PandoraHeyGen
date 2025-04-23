import { NextResponse } from "next/server";
import { listFiles, downloadFile } from "@/services/rag-test";

export async function GET() {
  try {
    const files = await listFiles();
    return NextResponse.json({ files });
  } catch (error) {
    console.error("Error listing files:", error);
    return NextResponse.json({ error: "Failed to list files" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { fileName } = await request.json();
    const content = await downloadFile(fileName);
    return NextResponse.json({ content });
  } catch (error) {
    console.error("Error downloading file:", error);
    return NextResponse.json({ error: "Failed to download file" }, { status: 500 });
  }
}