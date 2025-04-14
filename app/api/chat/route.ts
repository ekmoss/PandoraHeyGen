import { NextResponse } from "next/server";

// Add LRU cache for repeated queries
import { LRUCache } from "lru-cache";

// Simple response cache with 10 minute TTL, max 100 items
const responseCache = new LRUCache<string, any>({
  max: 100,
  ttl: 1000 * 60 * 10, // 10 minutes
  allowStale: false,
});

// Add optimized model parameters
const OPTIMIZED_MODEL_PARAMS = {
  temperature: 0.9, // Higher temperature for faster responses
  top_p: 0.5, // Lower top_p to reduce token consideration
  max_tokens: 150, // Reasonable limit for responses
  presence_penalty: 0, // No penalty for repeated tokens
  frequency_penalty: 0, // No penalty for frequency
};

export async function POST(request: Request) {
  const startTime = performance.now();
  const metrics: Record<string, number> = {};

  try {
    // Parse request data
    const parseRequestStartTime = performance.now();
    const requestData = await request.json();
    metrics.parseRequest = performance.now() - parseRequestStartTime;

    // Get environment variables
    const getEnvStartTime = performance.now();
    const apiKey = process.env.AZURE_OPENAI_API_KEY;
    const apiEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const apiVersion =
      process.env.AZURE_OPENAI_API_VERSION || "2023-07-01-preview";

    // Check multiple possible deployment name environment variables
    const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4o"; // Explicit fallback to gpt-4o

    console.log(`Using OpenAI deployment: ${deploymentName}`);
    metrics.getEnvironment = performance.now() - getEnvStartTime;

    if (!apiKey || !apiEndpoint) {
      console.error("API key or endpoint not found");
      return NextResponse.json(
        { error: "API configuration error" },
        { status: 500 }
      );
    }

    // Prepare request
    const prepareRequestStartTime = performance.now();
    const apiUrl = `${apiEndpoint}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;

    // Ensure messages array is properly formatted
    let messages = requestData.messages;

    // If messages array is not provided or empty, create a default one with the message
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      const message = requestData.message || "";

      messages = [
        {
          role: "system",
          content:
            "You are a helpful assistant. Provide clear, concise responses.",
        },
        {
          role: "user",
          content: message,
        },
      ];
    }

    // Apply optimized parameters to user request
    const optimizedRequestData = {
      messages: messages,
      temperature:
        requestData.temperature ?? OPTIMIZED_MODEL_PARAMS.temperature,
      top_p: requestData.top_p ?? OPTIMIZED_MODEL_PARAMS.top_p,
      max_tokens: requestData.max_tokens ?? OPTIMIZED_MODEL_PARAMS.max_tokens,
      presence_penalty: OPTIMIZED_MODEL_PARAMS.presence_penalty,
      frequency_penalty: OPTIMIZED_MODEL_PARAMS.frequency_penalty,
    };

    console.log("Sending optimized request to Azure OpenAI:", {
      endpoint: apiUrl,
      messageCount: optimizedRequestData.messages.length,
      userMessage: messages[messages.length - 1]?.content?.slice(0, 50) + "...",
    });

    metrics.prepareRequest = performance.now() - prepareRequestStartTime;

    // Set a reasonable timeout - longer to ensure we get a response
    const timeoutMs = 8000; // 8 seconds max
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    // Call OpenAI API with optimized connection settings
    const openAIStartTime = performance.now();
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
        Connection: "keep-alive",
        Accept: "application/json",
      },
      body: JSON.stringify(optimizedRequestData),
      signal: controller.signal,
      keepalive: true,
    });
    clearTimeout(timeoutId);

    metrics.openAIApiCall = performance.now() - openAIStartTime;

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Chat API error: ${response.status}`, errorText);
      throw new Error(`Chat API error: ${response.status} - ${errorText}`);
    }

    // Parse response
    const parseResponseStartTime = performance.now();
    const data = await response.json();
    metrics.parseResponse = performance.now() - parseResponseStartTime;

    // Extract the actual response message with better fallbacks
    let responseMessage = null;

    // Try different paths to find the response content
    if (data.choices && data.choices.length > 0) {
      if (data.choices[0].message?.content) {
        responseMessage = data.choices[0].message.content;
      } else if (data.choices[0].text) {
        responseMessage = data.choices[0].text;
      } else if (typeof data.choices[0] === "string") {
        responseMessage = data.choices[0];
      }
    }

    // Default fallback message if nothing found
    responseMessage =
      responseMessage || "I couldn't generate a response. Please try again.";

    console.log(
      "Chat API response extracted:",
      responseMessage.slice(0, 50) + "..."
    );

    // Calculate total time
    const endTime = performance.now();
    metrics.total = endTime - startTime;

    // Return data with the message extracted for easy access
    return NextResponse.json({
      message: responseMessage,
      choices: data.choices,
      metrics,
    });
  } catch (error) {
    console.error("Error in chat route:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    // Return a fallback response rather than an error
    return NextResponse.json({
      message: "I'm having trouble responding right now. Please try again.",
      error: `Error calling OpenAI API: ${errorMessage}`,
      metrics,
    });
  }
}

// Add support for HEAD requests (used for connection prefetching)
export async function HEAD(request: Request) {
  // Return a 200 status with minimal headers for fast prefetching
  return new Response(null, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      Connection: "keep-alive",
    },
  });
}
