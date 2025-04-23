import { SearchIndexerClient, AzureKeyCredential } from "@azure/search-documents";

const AZURE_SEARCH_SERVICE = process.env.AZURE_SEARCH_SERVICE!;
const AZURE_SEARCH_API_KEY = process.env.AZURE_SEARCH_API_KEY!;

export async function createRagIndexer() {
  const client = new SearchIndexerClient(
    AZURE_SEARCH_SERVICE,
    new AzureKeyCredential(AZURE_SEARCH_API_KEY)
  );

  const indexer = {
    name: "rag-pipeline-indexer",
    dataSourceName: "ts-rag-tutorial-ds", 
    targetIndexName: "test-index-3",
    skillsetName: "rag-pipeline-skillset",
    fieldMappings: [
      { sourceFieldName: "metadata_storage_name", targetFieldName: "title" }
    ],
    outputFieldMappings: [
      { sourceFieldName: "/document/pages/*", targetFieldName: "chunk" },
      { sourceFieldName: "/document/pages/*/text_vector", targetFieldName: "text_vector" },
      { sourceFieldName: "/document/pages/*/locations", targetFieldName: "locations" }
    ],
    parameters: {
      configuration: {
        dataToExtract: "contentAndMetadata"
      }
    }
  };

  await client.createIndexer(indexer);
  console.log(`${indexer.name} is created and running. Give the indexer a few minutes before running a query.`);
}