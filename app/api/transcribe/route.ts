import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    console.log("Received transcription request");
    const formData = await request.formData();
    const audioFile = formData.get("file") as Blob;

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

    // Get Azure OpenAI credentials from env
    const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT?.trim();
    const azureKey = process.env.AZURE_OPENAI_API_KEY?.trim();
    const whisperDeployment =
      process.env.AZURE_OPENAI_WHISPER_DEPLOYMENT?.trim();

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

    // Create a new FormData instance for Azure
    const azureFormData = new FormData();
    azureFormData.append("file", audioFile, "audio.webm");
    azureFormData.append("model", "whisper-1");
    azureFormData.append("language", "en");

    // Ensure endpoint format is correct
    const baseUrl = azureEndpoint.endsWith("/")
      ? azureEndpoint.slice(0, -1)
      : azureEndpoint;

    console.log("Sending request to Azure Whisper API");

    // Forward to Azure OpenAI's Whisper API
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

    const data = await azureResponse.json();
    console.log("Transcription successful:", data.text);

    return NextResponse.json({
      text: data.text,
    });
  } catch (error) {
    console.error("Error in transcribe API:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
