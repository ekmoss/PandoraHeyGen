import { NextResponse } from "next/server";
import {
  SearchIndexerClient,
  SearchIndexerDataContainer,
  SearchIndexerDataSourceConnection,
  AzureKeyCredential,
} from "@azure/search-documents";

// Azure configuration
const AZURE_SEARCH_SERVICE = process.env.AZURE_SEARCH_SERVICE!;
const AZURE_SEARCH_API_KEY = process.env.AZURE_SEARCH_API_KEY!;
const AZURE_STORAGE_CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING!;

/**
 * API route to create a data source connection for Azure Cognitive Search.
 * This can be tested using Postman or any HTTP client.
 */
export async function POST() {
  try {
    // Use AzureKeyCredential for API key-based authentication
    const indexerClient = new SearchIndexerClient(AZURE_SEARCH_SERVICE, new AzureKeyCredential(AZURE_SEARCH_API_KEY));

    const container: SearchIndexerDataContainer = {
      name: "tv25-pdfs-container",
    };

    const dataSourceConnection: SearchIndexerDataSourceConnection = {
      name: "ts-rag-tutorial-ds",
      type: "azureblob",
      connectionString: AZURE_STORAGE_CONNECTION_STRING,
      container,
    };

    const dataSource = await indexerClient.createOrUpdateDataSourceConnection(dataSourceConnection);
    console.log(`Data source '${dataSource.name}' created or updated`);

    return NextResponse.json({ message: `Data source '${dataSource.name}' created or updated` });
  } catch (err: any) {
    console.error("Error creating data source:", err);
    return NextResponse.json({ error: "Failed to create data source", details: err.message }, { status: 500 });
  }
}