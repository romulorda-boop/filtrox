'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler } = require('../../api/catalog-import-start');

const token = 'local-test-token-that-is-at-least-32-bytes-long';
const sasUrl = 'https://filtroxdata.blob.core.windows.net/catalogcontrol?sp=cw&sr=c&sv=2026-02-06&sig=synthetic-secret';
const fixedRunId = '123e4567-e89b-42d3-a456-426614174000';
const fixedTime = new Date('2026-11-18T13:00:00.000Z');

function setup(overrides = {}) {
  const env = {
    CATALOG_IMPORT_TOKEN: token,
    CATALOG_CONTROL_CONTAINER_SAS_URL: sasUrl,
    ...overrides.env
  };
  const uploads = [];
  const logs = [];
  const fetchImpl = overrides.fetchImpl || (async (url, options) => {
    uploads.push({ url: String(url), options });
    return new Response('', { status: 201, headers: { etag: '"etag-test"' } });
  });
  const handler = createHandler({
    env,
    fetchImpl,
    now: () => fixedTime,
    createRunId: overrides.createRunId || (() => fixedRunId),
    storageTimeoutMs: 8000
  });
  return { handler, uploads, logs };
}

function request({ method = 'POST', authorization = `Bearer ${token}`, body = { sources: ['xvideos', 'pornhub'] } } = {}) {
  return { method, headers: { authorization }, body };
}

async function invoke(handler, req) {
  const context = { log: { info: () => {}, warn: () => {} } };
  await handler(context, req);
  return context.res;
}

test('rejeita métodos diferentes de POST', async () => {
  const { handler, uploads } = setup();
  const response = await invoke(handler, request({ method: 'GET' }));
  assert.equal(response.status, 405);
  assert.equal(response.headers.Allow, 'POST');
  assert.equal(uploads.length, 0);
});

test('falha fechada quando os App Settings estão ausentes ou fracos', async () => {
  const { handler, uploads } = setup({ env: { CATALOG_IMPORT_TOKEN: 'short' } });
  const response = await invoke(handler, request());
  assert.equal(response.status, 503);
  assert.equal(uploads.length, 0);
});

test('rejeita token incorreto antes de validar ou acessar o Blob', async () => {
  const { handler, uploads } = setup();
  const response = await invoke(handler, request({ authorization: 'Bearer wrong-token' }));
  assert.equal(response.status, 401);
  assert.equal(uploads.length, 0);
});

test('valida que o corpo só contém fontes permitidas', async () => {
  const { handler, uploads } = setup();
  const response = await invoke(handler, request({ body: { sources: ['xvideos'], baseUrl: sasUrl } }));
  assert.equal(response.status, 400);
  assert.equal(uploads.length, 0);
});

test('rejeita fontes duplicadas ou desconhecidas', async () => {
  const { handler, uploads } = setup();
  const duplicate = await invoke(handler, request({ body: { sources: ['xvideos', 'xvideos'] } }));
  const unknown = await invoke(handler, request({ body: { sources: ['other'] } }));
  assert.equal(duplicate.status, 400);
  assert.equal(unknown.status, 400);
  assert.equal(uploads.length, 0);
});

test('grava um manifesto inicial com create-only e não devolve o SAS', async () => {
  const { handler, uploads } = setup();
  const response = await invoke(handler, request({ body: { sources: ['pornhub', 'xvideos'] } }));

  assert.equal(response.status, 201);
  assert.equal(response.body.runId, fixedRunId);
  assert.equal(response.body.status, 'initialized');
  assert.deepEqual(response.body.sources, ['xvideos', 'pornhub']);
  assert.equal(response.body.controlBlob, `imports/${fixedRunId}/state.json`);
  assert.equal(JSON.stringify(response.body).includes('synthetic-secret'), false);
  assert.equal(uploads.length, 1);
  assert.equal(new URL(uploads[0].url).pathname, `/catalogcontrol/imports/${fixedRunId}/state.json`);
  assert.equal(new URL(uploads[0].url).searchParams.get('sig'), 'synthetic-secret');
  assert.equal(uploads[0].options.method, 'PUT');
  assert.equal(uploads[0].options.headers['If-None-Match'], '*');
  assert.equal(uploads[0].options.headers['x-ms-blob-type'], 'BlockBlob');

  const state = JSON.parse(uploads[0].options.body);
  assert.equal(state.schemaVersion, 1);
  assert.equal(state.runId, fixedRunId);
  assert.equal(state.phase, 'awaiting-source-validation');
  assert.deepEqual(Object.keys(state.sources), ['xvideos', 'pornhub']);
  assert.equal(state.sources.xvideos.rowsRead, 0);
  assert.equal(state.sources.pornhub.cursor, null);
  assert.equal(state.output.stagingPrefix, `versions/${fixedRunId}/`);
  assert.equal(JSON.stringify(state).includes('synthetic-secret'), false);
});

test('recusa um SAS que não esteja restrito a container Blob com create/write', async () => {
  const { handler, uploads } = setup({
    env: { CATALOG_CONTROL_CONTAINER_SAS_URL: 'https://filtroxdata.blob.core.windows.net/catalogcontrol?sp=r&sr=c&sig=synthetic' }
  });
  const response = await invoke(handler, request());
  assert.equal(response.status, 503);
  assert.equal(uploads.length, 0);
  assert.equal(JSON.stringify(response).includes('synthetic'), false);
});

test('recusa permissões SAS além de create/write', async () => {
  const { handler, uploads } = setup({
    env: { CATALOG_CONTROL_CONTAINER_SAS_URL: 'https://filtroxdata.blob.core.windows.net/catalogcontrol?sp=rcw&sr=c&sig=synthetic' }
  });
  const response = await invoke(handler, request());
  assert.equal(response.status, 503);
  assert.equal(uploads.length, 0);
});

test('não revela falhas ou conteúdo de erro retornados pelo Blob', async () => {
  const { handler } = setup({
    fetchImpl: async () => new Response('secret SAS value in provider error', { status: 403 })
  });
  const response = await invoke(handler, request());
  assert.equal(response.status, 503);
  assert.equal(JSON.stringify(response).includes('secret SAS'), false);
  assert.equal(JSON.stringify(response).includes('sig='), false);
});
