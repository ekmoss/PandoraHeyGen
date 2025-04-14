import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const startTime = performance.now();
  const metrics: Record<string, number> = {};

  try {
    console.log("Received transcription request");

    // Step 1: Parse form data
    const parseStartTime = performance.now();
    const formData = await request.formData();
    const audioFile = formData.get("file") as Blob;
    const parseEndTime = performance.now();

    metrics.parseFormData = parseEndTime - parseStartTime;
    console.log(`Form data parsed in ${metrics.parseFormData.toFixed(2)}ms`);

    if (!audioFile) {
      console.error("No audio file found in request");
      return NextResponse.json(
        { error: "No audio file provided" },
        { status: 400 }
      );
    }

    console.log("Audio file received:", {
      type: audioFile.type,
      size: audioFile.size,
    });

    // Step 2: Get Azure OpenAI credentials
    const credentialsStartTime = performance.now();
    const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT?.trim();
    const azureKey = process.env.AZURE_OPENAI_API_KEY?.trim();
    const whisperDeployment =
      process.env.AZURE_OPENAI_WHISPER_DEPLOYMENT?.trim();
    const credentialsEndTime = performance.now();

    metrics.getCredentials = credentialsEndTime - credentialsStartTime;

    if (!azureEndpoint || !azureKey || !whisperDeployment) {
      console.error("Missing Azure OpenAI credentials or Whisper deployment:", {
        hasEndpoint: !!azureEndpoint,
        hasKey: !!azureKey,
        hasWhisperDeployment: !!whisperDeployment,
      });
      return NextResponse.json(
        {
          error: !whisperDeployment
            ? "Whisper deployment not configured. Please deploy a Whisper model and set AZURE_OPENAI_WHISPER_DEPLOYMENT."
            : "Azure OpenAI credentials not properly configured. Please check your environment variables.",
        },
        { status: 500 }
      );
    }

    // Step 3: Prepare the request to Azure
    const prepareStartTime = performance.now();
    const azureFormData = new FormData();
    azureFormData.append("file", audioFile, "audio.webm");
    azureFormData.append("model", "whisper-1");
    azureFormData.append("language", "en");

    // Ensure endpoint format is correct
    const baseUrl = azureEndpoint.endsWith("/")
      ? azureEndpoint.slice(0, -1)
      : azureEndpoint;
    const prepareEndTime = performance.now();

    metrics.prepareRequest = prepareEndTime - prepareStartTime;
    console.log(`Request prepared in ${metrics.prepareRequest.toFixed(2)}ms`);

    console.log("Sending request to Azure Whisper API");

    // Step 4: Send request to Azure OpenAI
    const apiCallStartTime = performance.now();
    const azureResponse = await fetch(
      `${baseUrl}/openai/deployments/${whisperDeployment}/audio/transcriptions?api-version=2023-09-01-preview`,
      {
        method: "POST",
        headers: {
          "api-key": azureKey,
        },
        body: azureFormData,
      }
    );
    const apiCallEndTime = performance.now();

    metrics.azureApiCall = apiCallEndTime - apiCallStartTime;
    console.log(
      `Azure API call completed in ${metrics.azureApiCall.toFixed(2)}ms`
    );

    // Handle specific error cases
    if (!azureResponse.ok) {
      const errorText = await azureResponse.text();
      console.error("Azure OpenAI API error response:", {
        status: azureResponse.status,
        statusText: azureResponse.statusText,
        error: errorText,
      });

      // Handle rate limiting
      if (azureResponse.status === 429) {
        const retryAfter = azureResponse.headers.get("retry-after");
        return NextResponse.json(
          { error: "Rate limit exceeded. Please try again later." },
          {
            status: 429,
            headers: retryAfter ? { "retry-after": retryAfter } : undefined,
          }
        );
      }

      return NextResponse.json(
        {
          error: `Azure OpenAI API error: ${azureResponse.status} - ${errorText || azureResponse.statusText}`,
        },
        { status: azureResponse.status }
      );
    }

    // Step 5: Parse the response
    const parseResponseStartTime = performance.now();
    const data = await azureResponse.json();
    const parseResponseEndTime = performance.now();

    metrics.parseResponse = parseResponseEndTime - parseResponseStartTime;
    console.log(`Response parsed in ${metrics.parseResponse.toFixed(2)}ms`);
    console.log("Transcription successful:", data.text);

    // Calculate total processing time
    const endTime = performance.now();
    const totalTime = endTime - startTime;
    metrics.total = totalTime;

    // Summary of timing metrics
    console.log("Transcription timing metrics:", {
      parseFormData: `${metrics.parseFormData.toFixed(2)}ms (${((metrics.parseFormData / totalTime) * 100).toFixed(2)}%)`,
      getCredentials: `${metrics.getCredentials.toFixed(2)}ms (${((metrics.getCredentials / totalTime) * 100).toFixed(2)}%)`,
      prepareRequest: `${metrics.prepareRequest.toFixed(2)}ms (${((metrics.prepareRequest / totalTime) * 100).toFixed(2)}%)`,
      azureApiCall: `${metrics.azureApiCall.toFixed(2)}ms (${((metrics.azureApiCall / totalTime) * 100).toFixed(2)}%)`,
      parseResponse: `${metrics.parseResponse.toFixed(2)}ms (${((metrics.parseResponse / totalTime) * 100).toFixed(2)}%)`,
      total: `${totalTime.toFixed(2)}ms`,
    });

    return NextResponse.json({
      text: data.text,
      metrics: metrics,
    });
  } catch (error) {
    console.error("Error in transcribe API:", error);

    // Calculate total time even in case of error
    const endTime = performance.now();
    metrics.total = endTime - startTime;
    console.log(`Transcribe API failed after ${metrics.total.toFixed(2)}ms`);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
        metrics: metrics,
      },
      { status: 500 }
    );
  }
}
