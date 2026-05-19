# Signing Upload Portal

A Node.js/Express web app that lets vendors upload `.ipa` or `.xcarchive.zip` files via a browser. Uploads are stored in Azure Blob Storage and automatically trigger the signing pipeline in Azure DevOps.

## Architecture

```
Vendor browser
   │  (Entra ID login)
   ▼
Express webapp ──► Azure Blob Storage
   │
   └──► Azure DevOps REST API ──► triggers azure-pipelines-signing.yml
                                       │
                                       └──► AzureCLI@2 downloads the blob, signs, publishes IPA
```

## Setup

### 1. Register an Entra ID app

In Entra ID > App registrations, create a new app:
- **Redirect URI** (Web): `https://your-domain/auth/callback` (and `http://localhost:3000/auth/callback` for dev)
- Generate a **client secret** under *Certificates & secrets*
- Note the **Tenant ID** and **Application (client) ID**

### 2. Create an Azure Storage account + container

- Storage account: e.g. `vendoruploads`
- Container: e.g. `vendor-uploads` (private)
- Grant the webapp identity (or the SP behind your service connection) `Storage Blob Data Contributor`

### 3. Create a PAT in Azure DevOps

- Scope: **Build (Read & execute)**
- Note your org URL, project name, and pipeline ID

### 4. Configure the webapp

```bash
cp .env.example .env
# edit .env with your values
npm install
npm start
```

Open <http://localhost:3000>.

### 5. Configure the pipeline

The pipeline ([../azure-pipelines-signing.yml](../azure-pipelines-signing.yml)) supports three input sources:
- `secureFile` — file uploaded to Library > Secure Files
- `localPath` — already on the agent
- `blobUrl` — downloaded from Azure Blob Storage (used by this webapp)

Set the pipeline variable `AZURE_SUBSCRIPTION_SERVICE_CONNECTION` to the name of your Azure Resource Manager service connection that has access to the storage account.

## Deployment

Deploy to Azure App Service (Linux, Node 20). Use a **managed identity** instead of a storage connection string for production — assign it `Storage Blob Data Contributor` on the storage account and leave `AZURE_STORAGE_CONNECTION_STRING` empty so the app falls back to `DefaultAzureCredential`.

## File size

Multer is configured with a 2 GB cap. App Service has its own request size limits — for very large uploads consider switching to direct browser-to-Blob uploads using SAS tokens.
