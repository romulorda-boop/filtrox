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

function safeHttpsUrl(value, base) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value, base);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function resolutionHeight(value) {
  if (typeof value === 'number' && value > 0) return value;
  if (typeof value === 'string') {
    const match = value.match(/(?:^|\D)(\d{3,4})\s*p\b/i);
    const number = match ? Number(match[1]) : Number(value);
    return Number.isFinite(number) && number > 0 ? number : undefined;
  }
  if (!isRecord(value)) return undefined;
  const height = asNumber(value.height);
  if (height && height > 0) return height;
  return resolutionHeight(value.resolution) ?? resolutionHeight(value.id) ?? resolutionHeight(value.label);
}

function readResolutionHeights(value) {
  const candidates = [];
  const addFile = (file) => {
    if (!isRecord(file)) return;
    const height = resolutionHeight(file);
    if (height) candidates.push(height);
  };
  resolutionHeight(value.resolution) && candidates.push(resolutionHeight(value.resolution));
  resolutionHeight(value.videoSource?.resolution) && candidates.push(resolutionHeight(value.videoSource.resolution));
  for (const file of [...(Array.isArray(value.files) ? value.files : []), ...(Array.isArray(value.videoFiles) ? value.videoFiles : [])]) addFile(file);
  if (Array.isArray(value.streamingPlaylists)) {
    for (const playlist of value.streamingPlaylists) {
      if (isRecord(playlist) && Array.isArray(playlist.files)) for (const file of playlist.files) addFile(file);
    }
  }
  return [...new Set(candidates)].sort((a, b) => a - b);
}

function readThumbnail(value, source) {
  const thumbnails = Array.isArray(value.thumbnails)
    ? value.thumbnails.filter(isRecord).map((thumbnail) => ({
      url: safeHttpsUrl(thumbnail.fileUrl, source.origin),
      width: asNumber(thumbnail.width) ?? 0,
      height: asNumber(thumbnail.height) ?? 0,
    })).filter((thumbnail) => thumbnail.url)
    : [];
  if (!thumbnails.length) {
    const fallback = safeHttpsUrl(value.thumbnailPath || value.previewPath, source.origin);
    return fallback ? { url: fallback, width: 0, height: 0 } : undefined;
  }
  const smaller = thumbnails.filter((thumbnail) => thumbnail.width > 0 && thumbnail.width <= 720);
  const choices = smaller.length ? smaller : thumbnails;
  return choices.sort((a, b) => b.width - a.width)[0];
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
  const thumbnail = readThumbnail(value, source);

  return {
    uuid: value.uuid,
    name: value.name,
    url: source.href,
    embedPath: typeof value.embedPath === 'string' ? value.embedPath : undefined,
    privacy,
    nsfwFlags: asNumber(value.nsfwFlags) ?? 0,
    tags,
    thumbnailUrl: thumbnail?.url,
    thumbnailWidth: thumbnail?.width,
    thumbnailHeight: thumbnail?.height,
    resolutionHeights: readResolutionHeights(value),
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
