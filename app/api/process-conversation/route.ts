import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "edge"; // Add edge runtime for better performance

// Types for the request and response
interface ProcessConversationRequest {
  text: string;
  context?: string;
  conversationHistory?: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  language?: string;
}

interface ProcessConversationResponse {
  response: string;
  processingTime: number;
  confidence?: number;
  error?: string;
}

// Initialize Azure OpenAI client
const openai = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT}`,
  defaultQuery: { "api-version": process.env.AZURE_OPENAI_API_VERSION },
  defaultHeaders: { "api-key": process.env.AZURE_OPENAI_API_KEY },
});

export async function POST(request: NextRequest) {
  console.log("Processing conversation request..."); // Add logging
  const startTime = Date.now();

  try {
    // Log configuration (sanitized)
    console.log("Azure OpenAI Configuration:", {
      baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT}`,
      apiVersion: process.env.AZURE_OPENAI_API_VERSION,
      deployment: process.env.AZURE_OPENAI_DEPLOYMENT,
    });

    // Input validation
    if (!request.body) {
      return NextResponse.json(
        { error: "Request body is required" },
        { status: 400 }
      );
    }

    const data = (await request.json()) as ProcessConversationRequest;
    console.log("Request data:", { ...data, text: data.text.substring(0, 50) }); // Log truncated request data

    if (!data.text || typeof data.text !== "string") {
      return NextResponse.json(
        { error: "Text is required and must be a string" },
        { status: 400 }
      );
    }

    // Construct the system message based on context and language
    const systemMessage = `You are ${process.env.NEXT_PUBLIC_AVATAR_NAME || "an AI assistant"}, ${
      process.env.NEXT_PUBLIC_AVATAR_TAGLINE || "a helpful AI assistant"
    }. ${data.context || ""} ${
      data.language ? `Respond in ${data.language}.` : "Respond in English."
    } Keep responses concise, natural, and engaging. Aim for a conversational tone while maintaining professionalism.`;

    // Prepare conversation history
    const messages = [
      { role: "system", content: systemMessage },
      ...(data.conversationHistory || []),
      { role: "user", content: data.text },
    ];

    console.log("Sending request to Azure OpenAI..."); // Add logging

    // Generate response using Azure OpenAI
    const completion = await openai.chat.completions.create({
      model: process.env.AZURE_OPENAI_DEPLOYMENT!,
      messages:
        messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      max_tokens: 150,
      temperature: 0.7,
      top_p: 0.95,
      frequency_penalty: 0.5,
      presence_penalty: 0.5,
    });

    // Extract the response text
    const responseText = completion.choices[0]?.message?.content || "";

    if (!responseText) {
      throw new Error("No response generated");
    }

    // Calculate processing time
    const processingTime = Date.now() - startTime;

    console.log("Successfully generated response:", {
      processingTime,
      responseLength: responseText.length,
    }); // Add logging

    return NextResponse.json({
      response: responseText,
      processingTime,
      confidence: completion.choices[0]?.finish_reason === "stop" ? 1.0 : 0.8,
    } as ProcessConversationResponse);
  } catch (error) {
    console.error("Error in conversation processing:", error);

    // Handle specific error types
    if (error instanceof Error) {
      if (error.message.includes("API key")) {
        return NextResponse.json(
          { error: "Authentication error with Azure OpenAI" },
          { status: 401 }
        );
      }
      if (error.message.includes("timeout")) {
        return NextResponse.json(
          { error: "Request timed out" },
          { status: 408 }
        );
      }
      if (error.message.includes("rate")) {
        return NextResponse.json(
          { error: "Rate limit exceeded" },
          { status: 429 }
        );
      }
      // Add specific handling for 404
      if (error.message.includes("404")) {
        return NextResponse.json(
          {
            error:
              "Azure OpenAI deployment not found. Please check your configuration.",
            details: {
              message: error.message,
              baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT}`,
              apiVersion: process.env.AZURE_OPENAI_API_VERSION,
            },
          },
          { status: 404 }
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
