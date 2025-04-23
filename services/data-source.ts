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

// Create a data source
async function createDataSource() {
  // Use AzureKeyCredential for API key-based authentication
  const indexerClient = new SearchIndexerClient(
    AZURE_SEARCH_SERVICE,
    new AzureKeyCredential(AZURE_SEARCH_API_KEY)
  );

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
}

createDataSource().catch((err) => {
  console.error("Error creating data source:", err);
});