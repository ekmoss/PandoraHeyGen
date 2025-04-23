import { AzureKeyCredential, SearchIndexClient } from "@azure/search-documents";

const AZURE_SEARCH_SERVICE = process.env.AZURE_SEARCH_SERVICE!;
const AZURE_SEARCH_API_KEY = process.env.AZURE_SEARCH_API_KEY!;

export async function createSearchIndex() {
  const indexName = "test-index-1";
  const indexClient = new SearchIndexClient(AZURE_SEARCH_SERVICE, new AzureKeyCredential(AZURE_SEARCH_API_KEY));

  // Define the simplest possible index schema
  const fields = [
    {
      name: "id",
      type: "Edm.String",
      key: true,
      searchable: true
    },
    {
      name: "content",
      type: "Edm.String",
      searchable: true
    }
  ];

  const index = {
    name: indexName,
    fields
  };

  try {
    const result = await indexClient.createIndex(index);
    console.log(`Index '${result.name}' created successfully.`);
    return result;
  } catch (error) {
    console.error("Error creating index:", error);
    throw error;
  }
}