import { NextRequest, NextResponse } from "next/server";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import OpenAI from "openai";

export const runtime = "edge";

// Types for the request and response
interface ProcessVoiceRequest {
  audio: Blob;
  language?: string;
  context?: string;
  conversationHistory?: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
}

interface ProcessVoiceResponse {
  text?: string; // Transcribed text
  response: string; // LLM response
  confidence?: number; // Confidence score
  processingTime: number; // Processing time in ms
  error?: string; // Error message if any
}

// Initialize Azure OpenAI client
const openai = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT}`,
  defaultQuery: { "api-version": process.env.AZURE_OPENAI_API_VERSION },
  defaultHeaders: { "api-key": process.env.AZURE_OPENAI_API_KEY },
});

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  console.log("Processing voice request...");

  try {
    // Get form data
    const formData = await request.formData();
    const audioFile = formData.get("audio") as Blob;
    const language = (formData.get("language") as string) || "en-US";
    const context = (formData.get("context") as string) || "";
    const conversationHistory = JSON.parse(
      (formData.get("conversationHistory") as string) || "[]"
    );

    if (!audioFile) {
      return NextResponse.json(
        { error: "No audio file provided" },
        { status: 400 }
      );
    }

    // 1. Speech to Text Conversion
    console.log("Starting speech-to-text conversion...");

    // Create Speech Config with proper audio settings
    const speechConfig = sdk.SpeechConfig.fromSubscription(
      process.env.AZURE_SPEECH_KEY!,
      process.env.AZURE_SPEECH_REGION!
    );
    speechConfig.speechRecognitionLanguage = language;

    // Configure recognition settings
    speechConfig.setProperty(
      sdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs,
      "5000"
    );
    speechConfig.setProperty(
      sdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs,
      "1000"
    );
    speechConfig.outputFormat = sdk.OutputFormat.Detailed;

    // Create audio stream from input
    const audioStream = sdk.AudioInputStream.createPushStream();

    // Write the audio data directly
    const arrayBuffer = await audioFile.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    audioStream.write(uint8Array.buffer);
    audioStream.close();

    // Create AudioConfig from the stream
    const audioConfig = sdk.AudioConfig.fromStreamInput(audioStream);

    // Create speech recognizer
    const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

    // Add event handlers for debugging
    recognizer.recognizing = (s, e) => {
      console.log(`RECOGNIZING: Text=${e.result.text}`);
    };

    recognizer.recognized = (s, e) => {
      console.log(`RECOGNIZED: Text=${e.result.text}`);
    };

    recognizer.canceled = (s, e) => {
      console.log(`CANCELED: Reason=${e.reason}`);
      if (e.reason === sdk.CancellationReason.Error) {
        console.log(`CANCELED: ErrorCode=${e.errorCode}`);
        console.log(`CANCELED: ErrorDetails=${e.errorDetails}`);
      }
    };

    recognizer.sessionStarted = (s, e) => {
      console.log("\nSession started event.");
    };

    recognizer.sessionStopped = (s, e) => {
      console.log("\nSession stopped event.");
    };

    // Get transcription with more detailed error handling
    const transcriptionResult = await new Promise<sdk.SpeechRecognitionResult>(
      (resolve, reject) => {
        recognizer.recognizeOnceAsync(
          (result) => {
            console.log("Recognition result:", {
              reason: sdk.ResultReason[result.reason], // Convert reason code to string
              text: result.text,
              offset: result.offset,
              duration: result.duration,
              properties: result.properties.getProperty(
                sdk.PropertyId.SpeechServiceResponse_JsonResult
              ),
            });
            resolve(result);
          },
          (error) => {
            console.error("Recognition error:", error);
            reject(error);
          }
        );
      }
    ).finally(() => {
      recognizer.close();
    });

    const transcribedText = transcriptionResult.text;
    console.log("Speech-to-text completed:", {
      text: transcribedText,
      reason: sdk.ResultReason[transcriptionResult.reason],
      resultId: transcriptionResult.resultId,
    });

    if (!transcribedText) {
      throw new Error(
        `No text transcribed from audio. Reason: ${sdk.ResultReason[transcriptionResult.reason]}`
      );
    }

    // 2. Generate Response using Azure OpenAI
    console.log("Generating response from transcribed text...");

    // Construct the system message
    const systemMessage = `You are ${process.env.NEXT_PUBLIC_AVATAR_NAME || "an AI assistant"}, ${
      process.env.NEXT_PUBLIC_AVATAR_TAGLINE || "a helpful AI assistant"
    }. ${context} ${
      language ? `Respond in ${language}.` : "Respond in English."
    } Keep responses concise, natural, and engaging. Aim for a conversational tone while maintaining professionalism.`;

    // Prepare conversation history
    const messages = [
      { role: "system", content: systemMessage },
      ...conversationHistory,
      { role: "user", content: transcribedText },
    ];

    // Generate response
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

    const responseText = completion.choices[0]?.message?.content;

    if (!responseText) {
      throw new Error("No response generated");
    }

    // Calculate total processing time
    const processingTime = Date.now() - startTime;

    console.log("Voice processing completed successfully:", {
      processingTime,
      transcriptionLength: transcribedText.length,
      responseLength: responseText.length,
    });

    // Return combined response
    return NextResponse.json({
      text: transcribedText,
      response: responseText,
      confidence: transcriptionResult.properties.getProperty(
        sdk.PropertyId.SpeechServiceResponse_JsonResult
      )
        ? JSON.parse(
            transcriptionResult.properties.getProperty(
              sdk.PropertyId.SpeechServiceResponse_JsonResult
            )
          ).NBest[0].Confidence
        : undefined,
      processingTime,
    } as ProcessVoiceResponse);
  } catch (error) {
    console.error("Error in voice processing:", error);

    // Handle specific error types
    if (error instanceof Error) {
      if (error.message.includes("API key")) {
        return NextResponse.json(
          { error: "Authentication error with Azure services" },
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
    }

    // Generic error response
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
