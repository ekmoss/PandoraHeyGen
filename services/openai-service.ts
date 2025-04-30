/**
 * OpenAI Service
 *
 * Centralizes all OpenAI API interactions including:
 * - Prompt engineering and formatting
 * - API calls with consistent error handling
 * - Response parsing and streaming support
 *
 * Use this service from any component that needs to interact with OpenAI
 */

import { SearchClient, AzureKeyCredential } from "@azure/search-documents";
import { AzureOpenAI } from "openai";
import { createParser } from 'eventsource-parser';

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  /**
   * Whether to use streaming for lower latency
   */
  stream?: boolean;

  /**
   * Custom temperature (0-1)
   * Lower values = more deterministic
   * Higher values = more creative
   */
  temperature?: number;

  /**
   * Custom system prompt to override the default
   */
  systemPrompt?: string;

  /**
   * Optional context or additional instructions to shape the response
   */
  contextInfo?: string;

  /**
   * Whether this is just a pre-connection warmup call
   */
  preConnect?: boolean;

  /**
   * Whether to use RAG to enhance responses with retrieved knowledge
   */
  useRAG?: boolean;

  /**
   * Optional search query to use for RAG retrieval
   * If not provided, the user message will be used
   */
  ragSearchQuery?: string;

  /**
   * Maximum number of documents to retrieve for RAG
   */
  ragMaxDocuments?: number;
  
  /**
   * Minimum score of documents to be passed to the LLM
   */
  minScore?: number;
}

export interface ChatResponse {
  message: string;
  metrics?: Record<string, number>;
  citations?: RagCitation[];
}

export interface PromptTemplates {
  default: string;
  factual: string;
  creative: string;
  [key: string]: string;
}

/**
 * Interface for documents retrieved during RAG
 */
export interface RagDocument {
  title: string;
  content: string;
  chunk_id: string;
  score?: number;
}

/**
 * Interface for citations that can be returned with RAG responses
 */
export interface RagCitation {
  text: string;
  source: string;
  url?: string;
}

// Centralized prompt templates that can be edited in one place
//Probably want to move/parameterisze this since Pandora names need to be changeable based on config
export const PROMPT_TEMPLATES: PromptTemplates = {
  default:
    "You are a helpful assistant called Maya. Provide clear, concise responses. Keep your answers brief but friendly.",
  factual:
    "You are a helpful assistant called Maya. Provide factual, accurate information without speculation. Focus on verified information only.",
  creative:
    "You are a creative assistant called Maya. Provide engaging, imaginative responses that are both helpful and interesting.",
  avatarAssistant:
    "You are Maya, a virtual assistant for Capgemini. Your responses should be professional, helpful, and reflect Capgemini brand values. Keep responses under 3 sentences when possible.",
  ragAssistant:
    "You are Maya, a virtual assistant for Capgemini with access to company knowledge. You have been provided with relevant documents to help answer the user's question. Use this context to provide accurate, helpful responses. When you use information from the provided documents, make sure to summarize rather than quoting directly. Your responses should be professional and reflect Capgemini brand values. Keep responses under 3 sentences when possible.",
  ragPrompt: `
You are an AI assistant that helps users learn from the information found in the source material.
Answer the query using only the sources provided below.
Use bullets if the answer has multiple points.
If the answer is longer than 3 sentences, provide a summary.
Answer ONLY with the facts listed in the list of sources below. Cite your source when you answer the question
If there isn't enough information below, say you don't know.
Do not generate answers that don't use the sources below.
Query: {query}
Sources:
{sources}
`,
};


const AZURE_OPENAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT!;
const AZURE_OPENAI_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT!;

const openai = new AzureOpenAI({
    deploymentName: AZURE_OPENAI_DEPLOYMENT,
    apiVersion: "2024-02-15-preview",
    endpoint: AZURE_OPENAI_ENDPOINT,
  });


/**
 * Formats a user message with the appropriate context and system prompt
 */
export function formatChatMessages(
  userMessage: string,
  options: ChatOptions = {}
): ChatMessage[] {
  const systemPrompt = options.systemPrompt || PROMPT_TEMPLATES.default;

  // Start with the system prompt
  const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }];

  // Add context information if provided
  if (options.contextInfo) {
    messages.push({
      role: "system",
      content: `Additional context: ${options.contextInfo}`,
    });
  }

  // Add the user message
  messages.push({ role: "user", content: userMessage });

  return messages;
}

/**
 * Retrieves relevant documents for the RAG pipeline
 *
 * This function should:
 * 1. Take a search query (or use the user message)
 * 2. Query a vector database or other knowledge source
 * 3. Return the most relevant documents
 * 4. Include performance metrics for benchmarking
 *
 * @param query The search query to use for document retrieval
 * @param options Configuration options for the retrieval process
 * @returns Array of retrieved documents with relevance scores
 */
interface VectorSearchConfig {
  maxDocuments?: number;
  minScore?: number;
  fields?: string[];
}

const AZURE_SEARCH_SERVICE = process.env.AZURE_SEARCH_SERVICE!;
const AZURE_SEARCH_API_KEY = process.env.AZURE_SEARCH_API_KEY!;
const INDEX_NAME = process.env.AZURE_SEARCH_SERVICE_INDEX_NAME!;

export async function retrieveRelevantDocuments(
  query: string,
  options: VectorSearchConfig = {}
): Promise<{
  documents: RagDocument[];
  metrics: { [key: string]: number };
}> {
  const startTime = performance.now();
  const metrics: { [key: string]: number } = {};

  try {
    console.log(`[RAG] Retrieving documents for query: "${query}"`);

    const searchClient = new SearchClient(
      AZURE_SEARCH_SERVICE,
      INDEX_NAME,
      new AzureKeyCredential(AZURE_SEARCH_API_KEY)
    );

    const searchStartTime = performance.now();
    const searchResults = await searchClient.search("*", {
      vectorSearchOptions: {
        queries: [
          {
            kind: "text",
            fields: options.fields || ["content_vector"],
            kNearestNeighborsCount: options.maxDocuments || 5,
            text: query
          }
        ]
      },
      select: ["title", "content", "chunk_id"],
      top: options.maxDocuments || 5
    });
    metrics.searchTime = performance.now() - searchStartTime;

    const documents: RagDocument[] = [];
    for await (const result of searchResults.results) {
      if (result.document && (!options.minScore || result.score >= options.minScore)) {
        documents.push({
          title: result.document.title || 'N/A',
          content: result.document.content || 'N/A',
          chunk_id: result.document.chunk_id || 'N/A',
          score: result.score
        });
      }
    }

    metrics.totalRetrievalTime = performance.now() - startTime;
    console.log(`[RAG] Found ${documents.length} relevant documents`);

    console.log('[RAG] Retrieved documents with scores:', 
      documents.map(d => ({
        chunk_id: d.chunk_id,
        score: d.score
      }))
    );

    return {
      documents,
      metrics,
    };
  } catch (error) {
    console.error("[RAG] Error retrieving documents:", error);
    metrics.totalRetrievalTime = performance.now() - startTime;
    metrics.error = 1;
    throw error;
  }
}

/**
 * Formats retrieved documents into a context string for the LLM
 *
 * @param documents The retrieved documents to format
 * @returns A formatted context string for inclusion in the prompt
 */
export function formatRetrievedDocuments(documents: RagDocument[]): string {
  if (!documents || documents.length === 0) {
    return "";
  }

  return documents
    .map(doc => 
      `TITLE: ${doc.title}, ` +
      `CONTENT: ${doc.content}, ` +
      `CHUNK_ID: ${doc.chunk_id}` +
      (doc.score !== undefined ? `, SCORE: ${doc.score}` : '')
    )
    .join("\n=================\n");
}

/**
 * Complete RAG (Retrieval Augmented Generation) pipeline
 *
 * This function:
 * 1. Takes a user message
 * 2. Retrieves relevant documents
 * 3. Augments the prompt with retrieved information
 * 4. Calls the OpenAI API with the enhanced prompt
 *
 * @param userMessage The user's message/question
 * @param options Configuration options for the RAG process
 * @returns Response from the OpenAI API with the enhanced context
 */
export async function processWithRAG(
  userMessage: string,
  options: ChatOptions = {}
): Promise<Response> {
  // Start timing the RAG process
  const ragStartTime = performance.now();
  const ragMetrics: { [key: string]: number } = {};

  try {
    // 1. Determine the search query (use explicit search query or the user message)
    const searchQuery = options.ragSearchQuery || userMessage;

    // 2. Retrieve relevant documents
    const retrievalStartTime = performance.now();
    const { documents, metrics: retrievalMetrics } =
      await retrieveRelevantDocuments(searchQuery, {
        maxDocuments: options.ragMaxDocuments || 3,
        minScore: options.minScore  // Add this line
      });
    ragMetrics.retrievalTime = performance.now() - retrievalStartTime;

    // Add all retrieval metrics to our metrics object
    Object.entries(retrievalMetrics).forEach(([key, value]) => {
      ragMetrics[`retrieval_${key}`] = value;
    });

    // 3. If no relevant documents found, fall back to standard processing
    if (!documents || documents.length === 0) {
      console.log(
        "[RAG] No relevant documents found, using standard processing"
      );
      return processUserMessage(userMessage, options);
    }

    // 4. Format the retrieved documents into a context string
    const formatStartTime = performance.now();
    const documentContext = formatRetrievedDocuments(documents);
    ragMetrics.formatTime = performance.now() - formatStartTime;

    // 5. Create enhanced options with the RAG context
    const enhancedOptions: ChatOptions = {
      ...options,
      // Use the RAG-specific system prompt if one isn't already specified
      systemPrompt: options.systemPrompt || PROMPT_TEMPLATES.ragAssistant,
      // Add the retrieved context as contextInfo
      contextInfo: documentContext,
    };

    // 6. Format the messages with the enhanced options
    const prepareStartTime = performance.now();
    const messages = formatChatMessages(userMessage, enhancedOptions);
    ragMetrics.prepareTime = performance.now() - prepareStartTime;

    // 7. Call the OpenAI API with the enhanced messages
    const apiCallStartTime = performance.now();
    const response = await callChatApi(messages, enhancedOptions);
    ragMetrics.apiCallTime = performance.now() - apiCallStartTime;

    // 8. Calculate total RAG pipeline time
    ragMetrics.totalRagTime = performance.now() - ragStartTime;

    // 9. Attach RAG metrics to the response for monitoring
    // This requires modifying the response object to include the metrics
    const originalResponse = response.clone();

    // Create a new response with the metrics added
    const responseData = await originalResponse.json();
    const enhancedResponseData = {
      ...responseData,
      metrics: {
        ...responseData.metrics,
        ...ragMetrics,
      },
      // Could also add citations here
    };

    // Return a new response with the enhanced data
    return new Response(JSON.stringify(enhancedResponseData), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    console.error("[RAG] Error in RAG pipeline:", error);
    // If RAG fails, fall back to standard processing
    return processUserMessage(userMessage, options);
  }
}

/**
 * Calls the OpenAI API with the provided messages
 */
export async function callChatApi(
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<Response> {
  try {
    // Add debug logging for the complete prompt
    console.log('\n=== Complete Prompt ===');
    messages.forEach((msg, index) => {
      console.log(`\n[${msg.role.toUpperCase()}] Message ${index + 1}:`);
      console.log(msg.content);
    });
    console.log('\n=== End Prompt ===\n');

    const completion = await openai.chat.completions.create({
      model: AZURE_OPENAI_DEPLOYMENT,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: 800,
      stream: options.stream ?? true,
    });

    // If it's a pre-connection test, return success
    if (options.preConnect) {
      return new Response(JSON.stringify({ success: true }));
    }

    // Handle streaming response
    if (options.stream) {
      // Convert the streaming response to a Web API Response
      const stream = OpenAIStream(completion);
      return new Response(stream);
    }

    // Handle non-streaming response
    const content = completion.choices[0]?.message?.content || "";
    return new Response(JSON.stringify({
      message: content,
      metrics: {
        completionTokens: completion.usage?.completion_tokens,
        promptTokens: completion.usage?.prompt_tokens,
        totalTokens: completion.usage?.total_tokens,
      }
    }));

  } catch (error) {
    console.error("Error in OpenAI service:", error);
    throw error;
  }
}

// Add helper function for streaming
function OpenAIStream(response: any) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream({
    async start(controller) {
      function onParse(event: any) {
        if (event.type === 'event') {
          const data = event.data;
          if (data === '[DONE]') {
            controller.close();
            return;
          }
          try {
            const json = JSON.parse(data);
            const text = json.choices[0]?.delta?.content || '';
            const queue = encoder.encode(text);
            controller.enqueue(queue);
          } catch (e) {
            controller.error(e);
          }
        }
      }

      const parser = createParser(onParse);

      for await (const chunk of response) {
        parser.feed(decoder.decode(chunk));
      }
    },
  });

  return stream;
}

/**
 * Processes a user message through OpenAI
 * Main entry point for most simple chat use cases
 */
export async function processUserMessage(
  userMessage: string,
  options: ChatOptions = {}
): Promise<Response> {
  // If RAG is enabled, use the RAG pipeline
  if (options.useRAG) {
    return processWithRAG(userMessage, options);
  }

  // Otherwise, use the standard process
  const messages = formatChatMessages(userMessage, options);
  return await callChatApi(messages, options);
}

/**
 * Helper function to parse non-streaming responses
 */
export async function parseJsonResponse(
  response: Response
): Promise<ChatResponse> {
  try {
    const data = await response.json();
    //Better error messages?
    return {
      message:
        data.message ||
        (data.choices && data.choices[0]?.message?.content) ||
        "I couldn't generate a response. Please try again.",
      metrics: data.metrics,
      citations: data.citations,
    };
  } catch (error) {
    console.error("Error parsing JSON response:", error);
    return {
      message: "Sorry, I encountered an error processing your request.",
    };
  }
}

/**
 * Prewarms connections to the API to reduce latency
 */
export async function prewarmConnection(): Promise<void> {
  try {
    await callChatApi([{ role: "system", content: "Connection test" }], {
      preConnect: true,
    });
    console.log("OpenAI API connection prewarmed");
  } catch (error) {
    console.error("Error prewarming connection:", error);
  }
}
