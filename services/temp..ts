// export class Indexer {
//     private blobStorage: BlobStorage;
  
//     constructor(
//       private logger: BaseLogger,
//       private azure: AzureClients,
//       private openai: OpenAiService,
//       private embeddingModelName: string = 'text-embedding-ada-002',
//     ) {
//       this.blobStorage = new BlobStorage(logger, azure);
//     }
  
//     async createSearchIndex(indexName: string, useSemanticRanker = false) {
//       this.logger.debug(`Ensuring search index "${indexName}" exists`);
  
//       const searchIndexClient = this.azure.searchIndex;
  
//       const names: string[] = [];
//       const indexNames = await searchIndexClient.listIndexes();
//       for await (const index of indexNames) {
//         names.push(index.name);
//       }
//       if (names.includes(indexName)) {
//         this.logger.debug(`Search index "${indexName}" already exists`);
      
//     } else {
//         const index: SearchIndex = {
//           name: indexName,
//           vectorSearch: {
//             algorithms: [
//               {
//                 name: 'vector-search-algorithm',
//                 kind: 'hnsw',
//                 parameters: {
//                   m: 4,
//                   efSearch: 500,
//                   metric: 'cosine',
//                   efConstruction: 400,
//                 },
//               },
//             ],
//             profiles: [
//               {
//                 name: 'vector-search-profile',
//                 algorithmConfigurationName: 'vector-search-algorithm',
//               },
//             ],
//           },
//           ...(useSemanticRanker
//             ? {
//                 semanticSearch: {
//                   defaultConfigurationName: 'semantic-search-config',
//                   configurations: [
//                     {
//                       name: 'semantic-search-config',
//                       prioritizedFields: {
//                         contentFields: [
//                           {
//                             name: 'content',
//                           },
//                         ],
//                       },
//                     },
//                   ],
//                 },
//               }
//             : {}),
//           fields: [
//             {
//               name: 'id',
//               type: 'Edm.String',
//               key: true,
//             },
//             {
//               name: 'content',
//               type: 'Edm.String',
//               searchable: true,
//               analyzerName: 'en.microsoft',
//             },
//             {
//               name: 'embedding',
//               type: 'Collection(Edm.Single)',
//               hidden: false,
//               searchable: true,
//               filterable: false,
//               sortable: false,
//               facetable: false,
//               vectorSearchDimensions: 1536,
//               vectorSearchProfileName: 'vector-search-profile',
//             },
//             {
//               name: 'category',
//               type: 'Edm.String',
//               filterable: true,
//               facetable: true,
//             },
//             {
//               name: 'sourcepage',
//               type: 'Edm.String',
//               filterable: true,
//               facetable: true,
//             },
//             {
//               name: 'sourcefile',
//               type: 'Edm.String',
//               filterable: true,
//               facetable: true,
//             },
//           ],
//         };
//         this.logger.debug(`Creating "${indexName}" search index...`);
//         await searchIndexClient.createIndex(index);
//         }
//     }

https://github.com/Azure-Samples/azure-search-openai-javascript/blob/03d10d34772559a870b1b1a579c388247da17e85/packages/indexer/src/lib/indexer.ts#L40