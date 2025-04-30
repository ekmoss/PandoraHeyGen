import { SearchClient, AzureKeyCredential } from "@azure/search-documents";
import { AzureOpenAI } from "openai";

const AZURE_SEARCH_SERVICE = process.env.AZURE_SEARCH_SERVICE!;
const AZURE_SEARCH_API_KEY = process.env.AZURE_SEARCH_API_KEY!;
const INDEX_NAME = process.env.AZURE_SEARCH_SERVICE_INDEX_NAME!;
const AZURE_OPENAI_KEY = process.env.AZURE_OPENAI_API_KEY!;
const AZURE_OPENAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT!;
const AZURE_OPENAI_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT!;

// Initialize Azure OpenAI client
const openai = new AzureOpenAI({
    deploymentName: AZURE_OPENAI_DEPLOYMENT,
    apiVersion: "2024-02-15-preview",
    endpoint: AZURE_OPENAI_ENDPOINT,
  });

  
/**
 * Interfaces for type safety
 */

interface SearchResult {
  title: string;
  content: string;
  chunk_id: string;
  score: number;
}

interface RAGResponse {
  answer: string;
  sources: string[];
}


// PROMPT_TEMPLATES.default
const GROUNDED_PROMPT = `
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
`;

/**
 * Creates a search client with proper authentication
 */
interface SearchDocument {
  title: string;
  content: string;
  chunk_id: string;
}

function createSearchClient(): SearchClient<SearchDocument> {
  return new SearchClient(
    AZURE_SEARCH_SERVICE,
    INDEX_NAME,
    new AzureKeyCredential(AZURE_SEARCH_API_KEY)
  );
}

/**
 * Formats search results into a readable string format
 */
function formatSearchResult(document: any, score?: number): string {
  return `TITLE: ${document.title || 'N/A'}, ` +
         `CONTENT: ${document.content || 'N/A'}, ` +
         `CHUNK_ID: ${document.chunk_id || 'N/A'}` +
         (score !== undefined ? `, SCORE: ${score}` : '');
}

/**
 * Tests the search pipeline by performing a vector search
 * @param query The search query to test
 * @returns Array of formatted search results
 */
export async function testSearchPipeline(query: string): Promise<string[]> {
  try {
    if (!query?.trim()) {
      throw new Error('Query string cannot be empty');
    }

    const searchClient = createSearchClient();
    const searchResults = await searchClient.search("*", {
      vectorSearchOptions: {
        queries: [
          {
            kind: "text",
            fields: ["content_vector"],
            kNearestNeighborsCount: 5,
            text: query
          }
        ]
      },
      select: ["title", "content", "chunk_id"],
      includeTotalCount: true
    });

    const sourcesFormatted: string[] = [];
    for await (const result of searchResults.results) {
      if (result.document) {
        sourcesFormatted.push(formatSearchResult(result.document, result.score));
      }
    }

    console.log(`Found ${sourcesFormatted.length} results`);
    return sourcesFormatted;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error("Error in testSearchPipeline:", errorMessage);
    throw new Error(`Failed to execute search: ${errorMessage}`);
  }
}

/**
 * Complete RAG pipeline that combines search and LLM completion
 * @param query The user's query
 * @returns Generated answer and source documents
 */
export async function completeRAGPipeline(query: string): Promise<RAGResponse> {
  try {
    // 1. Perform vector search
    const searchClient = createSearchClient();
    const searchResults = await searchClient.search("*", {
      vectorSearchOptions: {
        queries: [
          {
            kind: "text",
            fields: ["content_vector"],
            kNearestNeighborsCount: 5,
            text: query
          }
        ]
      },
      select: ["title", "content", "chunk_id"],
      includeTotalCount: true
    });

    // 2. Format search results
    const sourcesFormatted: string[] = [];
    for await (const result of searchResults.results) {
      if (result.document) {
        sourcesFormatted.push(formatSearchResult(result.document));
      }
    }

    // 3. Generate completion with OpenAI
    const formattedPrompt = GROUNDED_PROMPT
      .replace("{query}", query)
      .replace("{sources}", sourcesFormatted.join("\n=================\n"));

    const completion = await openai.chat.completions.create({
      model: AZURE_OPENAI_DEPLOYMENT,
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant that provides answers based on the given sources."
        },
        {
          role: "user",
          content: formattedPrompt
        }
      ],
      temperature: 0.7,
      max_tokens: 800
    });

    const answer = completion.choices[0]?.message?.content || "No answer generated";

    return {
      answer,
      sources: sourcesFormatted
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error("Error in RAG pipeline:", errorMessage);
    throw new Error(`Failed to execute RAG pipeline: ${errorMessage}`);
  }
}