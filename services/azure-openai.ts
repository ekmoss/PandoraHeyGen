/**
 * Service class for handling Azure OpenAI API interactions
 */
export class AzureOpenAIService {
  /**
   * Generate a response using Azure OpenAI
   * @param text The user's input text
   * @param options Optional parameters like language and context
   * @returns Promise<string> The generated response
   */
  async generateResponse(
    text: string,
    options?: {
      language?: string;
      context?: string;
    }
  ): Promise<string> {
    try {
      const response = await fetch("/api/generate-response", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          ...options,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to generate response");
      }

      const data = await response.json();
      return data.response;
    } catch (error) {
      console.error("Error generating response:", error);
      throw error;
    }
  }

  /**
   * Process voice input through Azure services
   * @param audioBlob The audio blob from the microphone
   * @param options Optional parameters
   * @returns Promise<string> The generated response
   */
  async processVoiceInput(
    audioBlob: Blob,
    options?: {
      language?: string;
      context?: string;
    }
  ): Promise<string> {
    try {
      // Create form data with audio
      const formData = new FormData();
      formData.append("audio", audioBlob);
      if (options?.language) {
        formData.append("language", options.language);
      }
      if (options?.context) {
        formData.append("context", options.context);
      }

      // Send to combined processing endpoint
      const response = await fetch("/api/process-voice", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to process voice input");
      }

      const data = await response.json();
      return data.response;
    } catch (error) {
      console.error("Error processing voice input:", error);
      throw error;
    }
  }
}
