export const SEPIA_SEARCH_API = 'https://sepiasearch.org/api/v1/search/videos';
export const PAGE_SIZE = 50;

export class SepiaSearchError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'SepiaSearchError';
    this.status = status;
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNumber(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function readIdentity(value) {
  if (!isRecord(value)) return undefined;
  return {
    name: typeof value.name === 'string' ? value.name : undefined,
    displayName: typeof value.displayName === 'string' ? value.displayName : undefined,
    host: typeof value.host === 'string' ? value.host : undefined,
  };
}

function readVideo(value) {
  if (!isRecord(value) || typeof value.uuid !== 'string' || typeof value.name !== 'string' || typeof value.url !== 'string') return undefined;
  let source;
  try {
    source = new URL(value.url);
  } catch {
    return undefined;
  }
  if (source.protocol !== 'https:' || source.username || source.password) return undefined;

  const privacy = isRecord(value.privacy) ? {
    id: typeof value.privacy.id === 'number' ? value.privacy.id : undefined,
    label: typeof value.privacy.label === 'string' ? value.privacy.label : undefined,
  } : undefined;
  const tags = Array.isArray(value.tags)
    ? value.tags.filter((tag) => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean)
    : [];

  return {
    uuid: value.uuid,
    name: value.name,
    url: source.href,
    embedPath: typeof value.embedPath === 'string' ? value.embedPath : undefined,
    privacy,
    nsfwFlags: asNumber(value.nsfwFlags) ?? 0,
    tags,
    duration: asNumber(value.duration),
    views: asNumber(value.views),
    likes: asNumber(value.likes),
    publishedAt: typeof value.publishedAt === 'string' ? value.publishedAt : undefined,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : undefined,
    account: readIdentity(value.account),
    channel: readIdentity(value.channel),
    videoChannel: readIdentity(value.videoChannel),
  };
}

function parseResponse(payload) {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new SepiaSearchError('O SepiaSearch retornou uma resposta fora do formato esperado.');
  }
  const rawCount = payload.data.length;
  const data = payload.data.map(readVideo).filter(Boolean);
  const totalValue = asNumber(payload.total);
  return { data, rawCount, total: totalValue !== undefined && totalValue >= 0 ? totalValue : rawCount };
}

export async function searchSepiaVideos({ query, start = 0, signal }) {
  const url = new URL(SEPIA_SEARCH_API);
  url.searchParams.set('search', query.trim());
  url.searchParams.set('privacyOneOf', '1');
  url.searchParams.set('nsfw', 'true');
  url.searchParams.set('count', String(PAGE_SIZE));
  url.searchParams.set('start', String(Math.max(0, start)));
  url.searchParams.set('skipCount', 'false');
  url.searchParams.set('sort', '-publishedAt');

  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new SepiaSearchError('Não foi possível acessar o índice SepiaSearch. Verifique a conexão ou tente novamente.');
  }

  if (!response.ok) throw new SepiaSearchError(`O SepiaSearch respondeu com erro HTTP ${response.status}.`, response.status);
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new SepiaSearchError('O SepiaSearch retornou dados que não puderam ser lidos como JSON.');
  }
  return parseResponse(payload);
}
