'use strict';

const { randomUUID, timingSafeEqual } = require('node:crypto');

const ALLOWED_SOURCES = Object.freeze(['xvideos', 'pornhub']);
const CONTROL_STATE_VERSION = 1;
const STORAGE_TIMEOUT_MS = 8000;
const AZURE_STORAGE_API_VERSION = '2023-11-03';
const MAX_BODY_BYTES = 4096;
const TOKEN_MIN_BYTES = 32;

function send(context, status, body, extraHeaders = {}) {
  context.res = {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders
    },
    body
  };
}

function getHeader(req, name) {
  const headers = req?.headers || {};
  const key = Object.keys(headers).find((headerName) => headerName.toLowerCase() === name.toLowerCase());
  const value = key ? headers[key] : undefined;
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function constantTimeTokenMatch(candidate, expected) {
  if (typeof candidate !== 'string' || typeof expected !== 'string') return false;
  const left = Buffer.from(candidate, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

function parseBearerToken(header) {
  const match = /^Bearer ([^\s]+)$/i.exec(header.trim());
  return match ? match[1] : '';
}

function parseContainerSas(raw) {
  if (typeof raw !== 'string' || !raw) throw new Error('Missing container SAS URL.');

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Invalid container SAS URL.');
  }

  const containerMatch = /^\/([a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9]))$/.exec(url.pathname);
  const rawPermissions = (url.searchParams.get('sp') || '').toLowerCase();
  const permissions = new Set(rawPermissions);
  if (
    url.protocol !== 'https:' ||
    !/^[a-z0-9]{3,24}\.blob\.core\.windows\.net$/i.test(url.hostname) ||
    url.username || url.password || url.hash ||
    !containerMatch || containerMatch[1].includes('--') ||
    url.searchParams.get('sr') !== 'c' ||
    rawPermissions.length !== 2 || permissions.size !== 2 ||
    !permissions.has('c') || !permissions.has('w') ||
    !url.searchParams.get('sig')
  ) {
    throw new Error('Container SAS URL is outside the allowed write scope.');
  }

  return url;
}

function buildBlobUrl(containerUrl, blobName) {
  const url = new URL(containerUrl.toString());
  const path = blobName.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  url.pathname = `${containerUrl.pathname}/${path}`;
  return url.toString();
}

function parseRequestBody(rawBody) {
  let body = rawBody;
  if (Buffer.isBuffer(body)) body = body.toString('utf8');

  if (typeof body === 'string') {
    if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
      const error = new Error('Request body is too large.');
      error.status = 413;
      throw error;
    }
    try {
      body = body ? JSON.parse(body) : {};
    } catch {
      const error = new Error('Request body must be valid JSON.');
      error.status = 400;
      throw error;
    }
  } else if (body && typeof body === 'object') {
    let serialized;
    try {
      serialized = JSON.stringify(body);
    } catch {
      const error = new Error('Request body is invalid.');
      error.status = 400;
      throw error;
    }
    if (Buffer.byteLength(serialized, 'utf8') > MAX_BODY_BYTES) {
      const error = new Error('Request body is too large.');
      error.status = 413;
      throw error;
    }
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    const error = new Error('Request body must be a JSON object.');
    error.status = 400;
    throw error;
  }
  return body;
}

function validateSources(body) {
  if (Object.keys(body).some((key) => key !== 'sources')) {
    const error = new Error('Only the sources field is accepted.');
    error.status = 400;
    throw error;
  }
  if (!Array.isArray(body.sources) || body.sources.length < 1 || body.sources.length > ALLOWED_SOURCES.length) {
    const error = new Error('Provide one or more supported sources.');
    error.status = 400;
    throw error;
  }
  if (body.sources.some((source) => typeof source !== 'string' || !ALLOWED_SOURCES.includes(source))) {
    const error = new Error('One or more sources are not supported.');
    error.status = 400;
    throw error;
  }
  if (new Set(body.sources).size !== body.sources.length) {
    const error = new Error('Duplicate sources are not allowed.');
    error.status = 400;
    throw error;
  }

  return ALLOWED_SOURCES.filter((source) => body.sources.includes(source));
}

function buildInitialState(runId, sources, createdAt) {
  const sourceStates = Object.fromEntries(sources.map((source) => [source, {
    status: 'pending',
    bytesRead: 0,
    rowsRead: 0,
    recordsAccepted: 0,
    recordsRemoved: 0,
    shardCount: 0,
    cursor: null,
    sourceEtag: null,
    removalEtag: null,
    error: null
  }]));

  return {
    schemaVersion: CONTROL_STATE_VERSION,
    kind: 'filtrox.catalog-import',
    runId,
    status: 'initialized',
    phase: 'awaiting-source-validation',
    createdAt,
    updatedAt: createdAt,
    sources: sourceStates,
    output: {
      version: runId,
      stagingPrefix: `versions/${runId}/`,
      manifestPath: `versions/${runId}/manifest.json`
    },
    error: null
  };
}

function createHandler({
  env = process.env,
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => new Date(),
  createRunId = randomUUID,
  storageTimeoutMs = STORAGE_TIMEOUT_MS
} = {}) {
  return async function startCatalogImport(context, req = {}) {
    const method = String(req.method || '').toUpperCase();
    if (method !== 'POST') {
      send(context, 405, { error: 'Use POST para iniciar uma importação.' }, { Allow: 'POST' });
      return;
    }

    const expectedToken = String(env.CATALOG_IMPORT_TOKEN || '');
    if (Buffer.byteLength(expectedToken, 'utf8') < TOKEN_MIN_BYTES) {
      send(context, 503, { error: 'Importação não configurada no servidor.' });
      return;
    }
    const suppliedToken = parseBearerToken(getHeader(req, 'authorization'));
    if (!constantTimeTokenMatch(suppliedToken, expectedToken)) {
      send(context, 401, { error: 'Autorização administrativa necessária.' }, { 'WWW-Authenticate': 'Bearer' });
      return;
    }

    let sources;
    try {
      const body = parseRequestBody(req.body);
      sources = validateSources(body);
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 400;
      send(context, status, { error: error.message });
      return;
    }

    let containerUrl;
    try {
      containerUrl = parseContainerSas(String(env.CATALOG_CONTROL_CONTAINER_SAS_URL || ''));
    } catch {
      send(context, 503, { error: 'Armazenamento de controle não configurado para gravação.' });
      return;
    }

    const createdAt = now().toISOString();
    let runId = '';
    let controlBlob = '';
    let state = null;
    let storageResponse = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      runId = String(createRunId());
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)) {
        send(context, 500, { error: 'Não foi possível inicializar a importação.' });
        return;
      }
      controlBlob = `imports/${runId}/state.json`;
      state = buildInitialState(runId, sources, createdAt);
      const blobUrl = buildBlobUrl(containerUrl, controlBlob);

      try {
        storageResponse = await fetchImpl(blobUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'If-None-Match': '*',
            'x-ms-blob-type': 'BlockBlob',
            'x-ms-blob-content-type': 'application/json; charset=utf-8',
            'x-ms-blob-cache-control': 'no-store',
            'x-ms-version': AZURE_STORAGE_API_VERSION
          },
          body: JSON.stringify(state),
          signal: AbortSignal.timeout(storageTimeoutMs)
        });
      } catch {
        context.log?.warn?.('Catalog import control write failed (network or timeout).');
        send(context, 503, { error: 'Não foi possível gravar o controle da importação no Blob.' });
        return;
      }

      if (storageResponse.status === 409 || storageResponse.status === 412) continue;
      break;
    }

    if (!storageResponse || storageResponse.status === 409 || storageResponse.status === 412) {
      send(context, 503, { error: 'Não foi possível reservar um controle de importação.' });
      return;
    }
    if (!storageResponse.ok) {
      context.log?.warn?.(`Catalog import control write failed (HTTP ${storageResponse.status}).`);
      send(context, 503, { error: 'Não foi possível gravar o controle da importação no Blob.' });
      return;
    }

    context.log?.info?.(`Catalog import initialized: runId=${runId}; sources=${sources.join(',')}.`);
    send(context, 201, {
      runId,
      status: state.status,
      createdAt,
      sources,
      controlBlob
    });
  };
}

const handler = createHandler();
handler.createHandler = createHandler;
handler.parseContainerSas = parseContainerSas;
handler.buildInitialState = buildInitialState;
module.exports = handler;
