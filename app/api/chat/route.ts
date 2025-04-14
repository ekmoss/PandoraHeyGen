import { NextResponse } from "next/server";

// Add LRU cache for repeated queries
import { LRUCache } from "lru-cache";

// Simple response cache with 10 minute TTL, max 100 items
const responseCache = new LRUCache<string, any>({
  max: 100,
  ttl: 1000 * 60 * 10, // 10 minutes
  allowStale: false,
});

export async function POST(request: Request) {
  const startTime = performance.now();
  const metrics: Record<string, number> = {};

  try {
    // Step 1: Parse request
    const parseStartTime = performance.now();
    const { message } = await request.json();
    const parseEndTime = performance.now();
    metrics.parseRequest = parseEndTime - parseStartTime;

    if (!message) {
      return NextResponse.json(
        { error: "No message provided" },
        { status: 400 }
      );
    }

    // Check cache for exact message match
    const cacheKey = message.trim().toLowerCase();
    const cachedResponse = responseCache.get(cacheKey);
    if (cachedResponse) {
      console.log("Chat response served from cache");
      return NextResponse.json({
        message: cachedResponse.message,
        metrics: {
          ...cachedResponse.metrics,
          cacheHit: true,
          total: performance.now() - startTime,
        },
      });
    }

    // Step 2: Get environment variables
    const envStartTime = performance.now();
    const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT?.trim();
    const azureKey = process.env.AZURE_OPENAI_API_KEY?.trim();
    const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT?.trim(); // This should be 'gpt-4o' from your .env
    const envEndTime = performance.now();
    metrics.getEnvironment = envEndTime - envStartTime;

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

    // Step 3: Prepare request
    const prepareStartTime = performance.now();
    // Ensure endpoint format is correct
    const baseUrl = azureEndpoint.endsWith("/")
      ? azureEndpoint.slice(0, -1)
      : azureEndpoint;
    const prepareEndTime = performance.now();
    metrics.prepareRequest = prepareEndTime - prepareStartTime;

    // Step 4: Call Azure OpenAI API
    console.log(
      "Calling Azure OpenAI API with message length:",
      message.length
    );
    const apiCallStartTime = performance.now();

    // Use AbortController to prevent hanging requests
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(
        `${baseUrl}/openai/deployments/${deploymentName}/chat/completions?api-version=2024-02-15-preview`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "api-key": azureKey,
            Connection: "keep-alive",
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
          signal: controller.signal,
          cache: "no-store",
        }
      );

      if (!response.ok) {
        const error = await response.text();
        console.error("Azure OpenAI API error:", error);
        throw new Error(`Azure OpenAI API error: ${response.statusText}`);
      }

      // Step 5: Parse response
      const parseResponseStartTime = performance.now();
      const data = await response.json();
      const aiResponse =
        data.choices[0]?.message?.content || "No response generated";
      const parseResponseEndTime = performance.now();
      metrics.parseResponse = parseResponseEndTime - parseResponseStartTime;

      // Calculate total time
      const endTime = performance.now();
      const totalTime = endTime - startTime;
      metrics.total = totalTime;

      // Log timing metrics
      console.log("Chat API timing metrics:", {
        parseRequest: metrics.parseRequest
          ? `${metrics.parseRequest.toFixed(2)}ms (${((metrics.parseRequest / totalTime) * 100).toFixed(2)}%)`
          : "N/A",
        getEnvironment: metrics.getEnvironment
          ? `${metrics.getEnvironment.toFixed(2)}ms (${((metrics.getEnvironment / totalTime) * 100).toFixed(2)}%)`
          : "N/A",
        prepareRequest: metrics.prepareRequest
          ? `${metrics.prepareRequest.toFixed(2)}ms (${((metrics.prepareRequest / totalTime) * 100).toFixed(2)}%)`
          : "N/A",
        apiCall: metrics.apiCall
          ? `${metrics.apiCall.toFixed(2)}ms (${((metrics.apiCall / totalTime) * 100).toFixed(2)}%)`
          : "N/A",
        parseResponse: metrics.parseResponse
          ? `${metrics.parseResponse.toFixed(2)}ms (${((metrics.parseResponse / totalTime) * 100).toFixed(2)}%)`
          : "N/A",
        total: totalTime ? `${totalTime.toFixed(2)}ms` : "N/A",
        messageLength: message ? message.length : 0,
        responseLength: aiResponse ? aiResponse.length : 0,
      });

      // Cache the response
      const responseObj = {
        message: aiResponse,
        metrics: metrics,
      };
      responseCache.set(cacheKey, responseObj);

      return NextResponse.json(responseObj);
    } finally {
      clearTimeout(timeoutId);
      const apiCallEndTime = performance.now();
      metrics.apiCall = apiCallEndTime - apiCallStartTime;
      console.log(`Azure OpenAI API call took ${metrics.apiCall.toFixed(2)}ms`);
    }
  } catch (error) {
    console.error("Error in chat API:", error);

    // Calculate total time even in case of error
    const endTime = performance.now();
    metrics.total = endTime - startTime;
    console.log(`Chat API failed after ${metrics.total.toFixed(2)}ms`);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
        metrics: metrics,
      },
      { status: 500 }
    );
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
