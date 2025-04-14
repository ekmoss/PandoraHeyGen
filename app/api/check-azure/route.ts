import { NextResponse } from "next/server";

export async function GET() {
  try {
    // Get Azure OpenAI credentials
    const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT?.trim();
    const azureKey = process.env.AZURE_OPENAI_API_KEY?.trim();
    const whisperDeployment =
      process.env.AZURE_OPENAI_WHISPER_DEPLOYMENT?.trim();
    const chatDeployment = process.env.AZURE_OPENAI_DEPLOYMENT?.trim();

    if (!azureEndpoint || !azureKey) {
      return NextResponse.json(
        {
          error: "Azure OpenAI credentials not configured",
          details: {
            hasEndpoint: !!azureEndpoint,
            hasKey: !!azureKey,
          },
        },
        { status: 500 }
      );
    }

    // Sanitized credentials for response
    const credentials = {
      endpoint: azureEndpoint ? `${azureEndpoint.substring(0, 20)}...` : null,
      keyProvided: !!azureKey,
      whisperDeployment: whisperDeployment || null,
      chatDeployment: chatDeployment || null,
    };

    // Get model information if available
    let models = [];
    if (azureEndpoint && azureKey) {
      try {
        // Ensure endpoint format is correct
        const baseUrl = azureEndpoint.endsWith("/")
          ? azureEndpoint.slice(0, -1)
          : azureEndpoint;

        const modelResponse = await fetch(
          `${baseUrl}/openai/deployments?api-version=2023-12-01-preview`,
          {
            headers: {
              "api-key": azureKey,
            },
          }
        );

        if (modelResponse.ok) {
          const modelData = await modelResponse.json();
          models = modelData.data.map((m: any) => ({
            id: m.id,
            model: m.model,
            status: m.status,
          }));
        }
      } catch (error) {
        console.error("Error fetching models:", error);
      }
    }

    return NextResponse.json({
      status: "success",
      credentials,
      models,
      supportedFormats: [
        "flac",
        "m4a",
        "mp3",
        "mp4",
        "mpeg",
        "mpga",
        "oga",
        "ogg",
        "wav",
        "webm",
      ],
    });
  } catch (error) {
    console.error("Error in check-azure API:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
