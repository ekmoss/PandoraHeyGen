import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { message } = await request.json();

    if (!message) {
      return NextResponse.json(
        { error: "No message provided" },
        { status: 400 }
      );
    }

    const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT?.trim();
    const azureKey = process.env.AZURE_OPENAI_API_KEY?.trim();
    const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT?.trim(); // This should be 'gpt-4o' from your .env

    if (!azureEndpoint || !azureKey || !deploymentName) {
      console.error("Missing Azure OpenAI configuration:", {
        hasEndpoint: !!azureEndpoint,
        hasKey: !!azureKey,
        hasDeployment: !!deploymentName,
      });
      return NextResponse.json(
        { error: "Azure OpenAI not properly configured" },
        { status: 500 }
      );
    }

    // Ensure endpoint format is correct
    const baseUrl = azureEndpoint.endsWith("/")
      ? azureEndpoint.slice(0, -1)
      : azureEndpoint;

    const response = await fetch(
      `${baseUrl}/openai/deployments/${deploymentName}/chat/completions?api-version=2024-02-15-preview`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": azureKey,
        },
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content:
                "You are a helpful assistant. Provide clear, concise responses.",
            },
            {
              role: "user",
              content: message,
            },
          ],
          max_tokens: 800,
          temperature: 0.7,
          frequency_penalty: 0,
          presence_penalty: 0,
          top_p: 0.95,
          stop: null,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error("Azure OpenAI API error:", error);
      throw new Error(`Azure OpenAI API error: ${response.statusText}`);
    }

    const data = await response.json();
    const aiResponse =
      data.choices[0]?.message?.content || "No response generated";

    return NextResponse.json({ message: aiResponse });
  } catch (error) {
    console.error("Error in chat API:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
