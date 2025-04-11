import { NextRequest, NextResponse } from "next/server";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";

// Types for the request and response
interface SpeechToTextRequest {
  audio: Blob;
  format?: string;
  language?: string;
}

interface SpeechToTextResponse {
  text: string;
  duration: number;
  confidence?: number;
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Get form data
    const formData = await request.formData();
    const audioFile = formData.get("audio") as Blob;
    const language = (formData.get("language") as string) || "en-US";

    if (!audioFile) {
      return NextResponse.json(
        { error: "No audio file provided" },
        { status: 400 }
      );
    }

    // Create Speech Config
    const speechConfig = sdk.SpeechConfig.fromSubscription(
      process.env.AZURE_SPEECH_KEY!,
      process.env.AZURE_SPEECH_REGION!
    );
    speechConfig.speechRecognitionLanguage = language;

    // Convert Blob to ArrayBuffer
    const arrayBuffer = await audioFile.arrayBuffer();
    // Create a PushAudioInputStream
    const audioStream = sdk.AudioInputStream.createPushStream();

    // Write the audio data to the stream
    const buffer = Buffer.from(new Uint8Array(arrayBuffer));
    audioStream.write(buffer.buffer);
    audioStream.close();

    // Create AudioConfig from the stream
    const audioConfig = sdk.AudioConfig.fromStreamInput(audioStream);

    // Create speech recognizer
    const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

    // Perform recognition
    const result = await new Promise<sdk.SpeechRecognitionResult>(
      (resolve, reject) => {
        recognizer.recognizeOnceAsync(
          (result) => resolve(result),
          (error) => reject(error)
        );
      }
    );

    const duration = Date.now() - startTime;

    if (result.reason === sdk.ResultReason.RecognizedSpeech) {
      return NextResponse.json({
        text: result.text,
        duration,
        confidence: result.properties?.getProperty(
          sdk.PropertyId.SpeechServiceResponse_JsonResult
        ),
      });
    } else {
      const error =
        result.reason === sdk.ResultReason.NoMatch
          ? "No speech could be recognized"
          : "Speech recognition canceled";
      return NextResponse.json({ error }, { status: 400 });
    }
  } catch (error) {
    console.error("Speech recognition error:", error);
    return NextResponse.json(
      { error: "Failed to process speech to text" },
      { status: 500 }
    );
  }
}
