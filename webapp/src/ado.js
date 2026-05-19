const axios = require('axios');

const {
  ADO_ORG_URL,
  ADO_PROJECT,
  ADO_PIPELINE_ID,
  ADO_PAT,
} = process.env;

async function runPipeline({ blobUrl, blobName, versionAction, manualVersion, requestedBy }) {
  const url = `${ADO_ORG_URL}/${encodeURIComponent(ADO_PROJECT)}/_apis/pipelines/${ADO_PIPELINE_ID}/runs?api-version=7.1-preview.1`;
  const auth = Buffer.from(`:${ADO_PAT}`).toString('base64');

  const body = {
    templateParameters: {
      inputSource: 'blobUrl',
      blobUrl,
      blobName,
      versionAction: versionAction || 'none',
      manualVersion: manualVersion || '',
    },
    variables: {
      requestedBy: { value: requestedBy || 'unknown', isSecret: false },
    },
  };

  const response = await axios.post(url, body, {
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
  });

  return {
    id: response.data.id,
    url: response.data._links?.web?.href,
    state: response.data.state,
  };
}

function authHeader() {
  const auth = Buffer.from(`:${ADO_PAT}`).toString('base64');
  return { Authorization: `Basic ${auth}` };
}

async function getBuildStatus(buildId) {
  const url = `${ADO_ORG_URL}/${encodeURIComponent(ADO_PROJECT)}/_apis/build/builds/${buildId}?api-version=7.1`;
  const response = await axios.get(url, { headers: authHeader() });
  return {
    id: response.data.id,
    status: response.data.status,   // "notStarted" | "inProgress" | "completed" | "cancelling" | ...
    result: response.data.result,   // "succeeded" | "failed" | "canceled" | "partiallySucceeded"
    url: response.data._links?.web?.href,
  };
}

async function getArtifactDownloadUrl(buildId, artifactName = 'signed-ipa') {
  const url = `${ADO_ORG_URL}/${encodeURIComponent(ADO_PROJECT)}/_apis/build/builds/${buildId}/artifacts?artifactName=${encodeURIComponent(artifactName)}&api-version=7.1`;
  const response = await axios.get(url, { headers: authHeader() });
  return response.data?.resource?.downloadUrl;
}

async function streamArtifactZip(buildId, artifactName = 'signed-ipa') {
  const downloadUrl = await getArtifactDownloadUrl(buildId, artifactName);
  if (!downloadUrl) throw new Error(`Artifact "${artifactName}" not found on build ${buildId}`);
  const response = await axios.get(downloadUrl, {
    headers: authHeader(),
    responseType: 'stream',
  });
  return response.data;
}

module.exports = { runPipeline, getBuildStatus, streamArtifactZip };
