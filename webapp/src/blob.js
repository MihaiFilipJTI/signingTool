const { BlobServiceClient } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');

const {
  AZURE_STORAGE_ACCOUNT,
  AZURE_STORAGE_CONTAINER,
  AZURE_STORAGE_CONNECTION_STRING,
} = process.env;

function getBlobServiceClient() {
  if (AZURE_STORAGE_CONNECTION_STRING) {
    return BlobServiceClient.fromConnectionString(AZURE_STORAGE_CONNECTION_STRING);
  }
  const url = `https://${AZURE_STORAGE_ACCOUNT}.blob.core.windows.net`;
  return new BlobServiceClient(url, new DefaultAzureCredential());
}

async function uploadBuffer({ buffer, originalName, contentType }) {
  const service = getBlobServiceClient();
  const container = service.getContainerClient(AZURE_STORAGE_CONTAINER);
  await container.createIfNotExists();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeName = originalName.replace(/[^A-Za-z0-9._-]/g, '_');
  const blobName = `${timestamp}__${safeName}`;

  const blockBlob = container.getBlockBlobClient(blobName);
  await blockBlob.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: contentType || 'application/octet-stream' },
  });

  return { blobName, blobUrl: blockBlob.url };
}

module.exports = { uploadBuffer };
