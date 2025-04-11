import { NextRequest, NextResponse } from "next/server";
import { OpenAIClient, AzureKeyCredential } from "@azure/openai";

// Types for the request and response
interface GenerateResponseRequest {
  text: string;
  context?: string;
  language?: string;
}

interface GenerateResponseResponse {
  response: string;
  processingTime?: number;
  error?: string;
}

// Initialize Azure OpenAI client
const client = new OpenAIClient(
  process.env.AZURE_OPENAI_ENDPOINT!,
  new AzureKeyCredential(process.env.AZURE_OPENAI_KEY!)
);

const deploymentId = process.env.AZURE_OPENAI_DEPLOYMENT!;

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Input validation
    if (!request.body) {
      return NextResponse.json(
        { error: "Request body is required" },
        { status: 400 }
      );
    }

    const data = (await request.json()) as GenerateResponseRequest;

    if (!data.text || typeof data.text !== "string") {
      return NextResponse.json(
        { error: "Text is required and must be a string" },
        { status: 400 }
      );
    }

    // Construct the system message based on context and language
    const systemMessage = `You are a helpful AI assistant. ${
      data.context ? data.context : ""
    }${
      data.language ? `Respond in ${data.language}.` : "Respond in English."
    } Keep responses concise and natural.`;

    // Generate response using Azure OpenAI
    const messages = [
      { role: "system", content: systemMessage },
      { role: "user", content: data.text },
    ];

    const response = await client.getChatCompletions(deploymentId, messages, {
      maxTokens: 150,
      temperature: 0.7,
      topP: 0.95,
      frequencyPenalty: 0,
      presencePenalty: 0,
    });

    // Extract the response text
    const responseText = response.choices[0]?.message?.content || "";

    if (!responseText) {
      throw new Error("No response generated");
    }

    // Calculate processing time
    const processingTime = Date.now() - startTime;

    return NextResponse.json({
      response: responseText,
      processingTime,
    } as GenerateResponseResponse);
  } catch (error) {
    console.error("Error in response generation:", error);

    // Handle specific error types
    if (error instanceof Error) {
      if (error.message.includes("API key")) {
        return NextResponse.json(
          { error: "Authentication error" },
          { status: 401 }
        );
      }
      if (error.message.includes("timeout")) {
        return NextResponse.json(
          { error: "Request timed out" },
          { status: 408 }
        );
      }
    }

    // Generic error response
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
