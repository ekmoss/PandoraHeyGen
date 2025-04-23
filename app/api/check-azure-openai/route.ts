import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || "2024-07-18";

  if (!apiKey || !endpoint || !deploymentName) {
    return NextResponse.json(
      { error: "Azure OpenAI credentials are not properly configured." },
      { status: 500 }
    );
  }

  try {
    const response = await fetch(
      `${endpoint}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": apiKey,
        },
        body: JSON.stringify({
          messages: [
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: "Hello, how are you?" },
          ],
          max_tokens: 50,
          temperature: 0.7,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `Azure OpenAI API error: ${response.status} - ${errorText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json({ response: data });
  } catch (error: any) {
    console.error("Error checking Azure OpenAI connection:", error);
    return NextResponse.json(
      { error: "Failed to connect to Azure OpenAI." },
      { status: 500 }
    );
  }
}