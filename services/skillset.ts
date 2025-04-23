import { SearchIndexerClient, AzureKeyCredential } from "@azure/search-documents";

const AZURE_SEARCH_SERVICE = process.env.AZURE_SEARCH_SERVICE!;
const AZURE_SEARCH_API_KEY = process.env.AZURE_SEARCH_API_KEY!;
const AZURE_OPENAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT!;
const AZURE_AI_MULTISERVICE_KEY = process.env.AZURE_AI_MULTISERVICE_KEY!;

export async function createRagSkillset() {
  const client = new SearchIndexerClient(
    AZURE_SEARCH_SERVICE,
    new AzureKeyCredential(AZURE_SEARCH_API_KEY)
  );

  const skillset = {
    name: "rag-pipeline-skillset",
    description: "Minimal skillset for RAG: chunking and embeddings",
    skills: [
      {
        "@odata.type": "#Microsoft.Skills.Text.SplitSkill",
        name: "split-skill",
        description: "Split documents into pages",
        context: "/document",
        textSplitMode: "pages",
        maximumPageLength: 2000,
        pageOverlapLength: 200,
        inputs: [
          { name: "text", source: "/document/content" }
        ],
        outputs: [
          { name: "textItems", targetName: "pages" }
        ]
      },
      {
        "@odata.type": "#Microsoft.Skills.Text.AzureOpenAIEmbeddingSkill",
        name: "embedding-skill",
        description: "Generate embeddings for each chunk",
        context: "/document/pages/*",
        resourceUri: AZURE_OPENAI_ENDPOINT,
        deploymentId: "text-embedding-3-large",
        modelName: "text-embedding-3-large",
        dimensions: 1024,
        inputs: [
          { name: "text", source: "/document/pages/*" }
        ],
        outputs: [
          { name: "embedding", targetName: "text_vector" }
        ]
      }
    ],
    cognitiveServices: {
      "@odata.type": "#Microsoft.Azure.Search.CognitiveServicesByKey",
      key: AZURE_AI_MULTISERVICE_KEY
    }
  };

  await client.createOrUpdateSkillset(skillset as any);
  console.log("Minimal RAG skillset created!");
}


// import { SearchIndexerClient, AzureKeyCredential } from "@azure/search-documents";

// const AZURE_SEARCH_SERVICE = process.env.AZURE_SEARCH_SERVICE!;
// const AZURE_SEARCH_API_KEY = process.env.AZURE_SEARCH_API_KEY!;
// const AZURE_OPENAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT!;
// const AZURE_AI_MULTISERVICE_KEY = process.env.AZURE_AI_MULTISERVICE_KEY!;

// export async function createRagSkillset() {
//   const client = new SearchIndexerClient(
//     AZURE_SEARCH_SERVICE,
//     new AzureKeyCredential(AZURE_SEARCH_API_KEY)
//   );

//   const skillset = {
//     name: "rag-pipeline-skillset",
//     description: "Splits documents, generates embeddings, and extracts entities for RAG",
//     skills: [
//       {
//         "@odata.type": "#Microsoft.Skills.Text.SplitSkill",
//         name: "split-skill",
//         description: "Split documents into pages",
//         context: "/document",
//         textSplitMode: "pages",
//         maximumPageLength: 2000,
//         pageOverlapLength: 200,
//         inputs: [
//           { name: "text", source: "/document/content" }
//         ],
//         outputs: [

//           { name: "textItems", targetName: "pages" }
//         ]
//       },
//       {
//         "@odata.type": "#Microsoft.Skills.Text.AzureOpenAIEmbeddingSkill",
//         name: "embedding-skill",
//         description: "Generate embeddings for each chunk",
//         context: "/document/pages/*",
//         resourceUri: AZURE_OPENAI_ENDPOINT,
//         deploymentId: "text-embedding-3-large",
//         modelName: "text-embedding-3-large",
//         dimensions: 1024,
//         inputs: [
//           { name: "text", source: "/document/pages/*" }
//         ],
//         outputs: [
//           { name: "embedding", targetName: "text_vector" }
//         ]
//       },
//       {
//         "@odata.type": "#Microsoft.Skills.Text.EntityRecognitionSkill",
//         name: "entity-skill",
//         description: "Extract locations from each chunk",
//         context: "/document/pages/*",
//         categories: ["Location"],
//         defaultLanguageCode: "en",
//         inputs: [
//           { name: "text", source: "/document/pages/*" }
//         ],
//         outputs: [
//           { name: "locations", targetName: "locations" }
//         ]
//       }
//     ],
//     cognitiveServices: {
//       "@odata.type": "#Microsoft.Azure.Search.CognitiveServicesByKey",
//       key: AZURE_AI_MULTISERVICE_KEY
//     }
//   };

//   await client.createOrUpdateSkillset(skillset as any);
//   console.log("Skillset created!");
// }