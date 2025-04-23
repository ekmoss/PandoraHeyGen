import { BlobServiceClient } from "@azure/storage-blob";

const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING!);
console.log("AZURE_STORAGE_CONNECTION_STRING:", process.env.AZURE_STORAGE_CONNECTION_STRING);

const containerName = "testing-docs-1";

export async function listFiles() {
    console.log("AZURE_STORAGE_CONNECTION_STRING:", process.env.AZURE_STORAGE_CONNECTION_STRING);

  const containerClient = blobServiceClient.getContainerClient(containerName);
  const blobs = [];
  for await (const blob of containerClient.listBlobsFlat()) {
    blobs.push(blob.name);
  }
  return blobs;
}

export async function downloadFile(fileName: string) {
  const containerClient = blobServiceClient.getContainerClient(containerName);
  const blobClient = containerClient.getBlobClient(fileName);
  const downloadBlockBlobResponse = await blobClient.download();
  const downloadedContent = await streamToString(downloadBlockBlobResponse.readableStreamBody!);
  return downloadedContent;
}

// Helper function to convert a readable stream to a string
export async function streamToString(readableStream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    readableStream.on("data", (data) => chunks.push(Buffer.from(data)));
    readableStream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    readableStream.on("error", reject);
  });
}

(async () => {
  // List files in the container
  const files = await listFiles();
  console.log("Files in Blob Storage:", files);

  // Download a specific file (replace 'your-file-name.txt' with the actual file name)
  if (files.length > 0) {
    const fileName = files[0]; // Replace with the name of the file you uploaded
    const content = await downloadFile(fileName);
    // console.log(`Content of ${fileName}:`, content);
  } else {
    console.log("No files found in the container.");
  }
})();