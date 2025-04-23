import { AzureKeyCredential, SearchIndexClient } from "@azure/search-documents";
import { type SearchIndex } from '@azure/search-documents';

const AZURE_SEARCH_SERVICE = process.env.AZURE_SEARCH_SERVICE!;
const AZURE_SEARCH_API_KEY = process.env.AZURE_SEARCH_API_KEY!;

export async function createSearchIndex() {
  const indexName = "test-index-3";
  const indexClient = new SearchIndexClient(AZURE_SEARCH_SERVICE, new AzureKeyCredential(AZURE_SEARCH_API_KEY));

  const useSemanticRanker = true;
  

  const index: SearchIndex = {
    name: indexName,

    vectorSearch: {
      algorithms: [
        {
          name: 'vector-search-algorithm',
          kind: 'hnsw',
          parameters: {
            m: 4,
            efSearch: 500,
            metric: 'cosine',
            efConstruction: 400,
          },
        },
      ],
      profiles: [
        {
          name: 'vector-search-profile',
          algorithmConfigurationName: 'vector-search-algorithm',
        },
      ],
    },

    ...(useSemanticRanker
      ? {
          semanticSearch: {
            defaultConfigurationName: 'semantic-search-config',
            configurations: [
              {
                name: 'semantic-search-config',
                prioritizedFields: {
                  contentFields: [
                    {
                      name: 'content',
                    },
                  ],
                },
              },
            ],
          },
        }
      : {}),

    fields: [
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
    ]
  };

  // Define the simplest possible index schema
  try {
    const result = await indexClient.createIndex(index);
    console.log(`Index '${result.name}' created successfully.`);
    return result;
  } catch (error) {
    console.error("Error creating index:", error);
    throw error;
  }
}