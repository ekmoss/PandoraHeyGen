import { SearchClient, AzureKeyCredential as SearchKeyCredential } from "@azure/search-documents";
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

interface SearchResult {
  title: string;
  content: string;
  chunk_id: string;
  score: number;
}

export async function testSearchPipeline(query: string): Promise<string[]> {
  try {
    if (!query?.trim()) {
      throw new Error('Query string cannot be empty');
    }

    const searchClient = new SearchClient(
      AZURE_SEARCH_SERVICE,
      INDEX_NAME,
      new SearchKeyCredential(AZURE_SEARCH_API_KEY)
    );

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
      queryLanguage: "en-us",
      includeTotalCount: true
    });

    const sourcesFormatted: string[] = [];
    
    for await (const result of searchResults.results) {
      if (result.document) {
        sourcesFormatted.push(
          `TITLE: ${result.document.title || 'N/A'}, ` +
          `CONTENT: ${result.document.content || 'N/A'}, ` +
          `CHUNK_ID: ${result.document.chunk_id || 'N/A'}, ` +
          `SCORE: ${result.score || 0}`
        );
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

export async function completeRAGPipeline(query: string): Promise<{ answer: string, sources: string[] }> {
  try {
    // 1. Set up search client
    const searchClient = new SearchClient(
      AZURE_SEARCH_SERVICE,
      INDEX_NAME,
      new SearchKeyCredential(AZURE_SEARCH_API_KEY)
    );

    // 2. Perform vector search (no changes needed)
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

    // 3. Format search results (no changes needed)
    const sourcesFormatted: string[] = [];
    for await (const result of searchResults.results) {
      if (result.document) {
        sourcesFormatted.push(
          `TITLE: ${result.document.title || 'N/A'}, ` +
          `CONTENT: ${result.document.content || 'N/A'}, ` +
          `CHUNK_ID: ${result.document.chunk_id || 'N/A'}`
        );
      }
    }

    // 4. Generate completion with OpenAI - Updated to use new SDK
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