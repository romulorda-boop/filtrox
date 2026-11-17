export const EXPLICIT_SEX_FLAG = 2;

function normalizeTag(value) {
  return String(value).trim().toLocaleLowerCase('pt-BR');
}

export function getEligibleVideos(videos) {
  return videos.filter((video) => video.privacy?.id === 1
    && (Number(video.nsfwFlags) & EXPLICIT_SEX_FLAG) === EXPLICIT_SEX_FLAG);
}

export function collectTagFacets(videos) {
  const tags = new Map();
  for (const video of videos) {
    const seen = new Set();
    for (const rawTag of video.tags) {
      const name = rawTag.trim();
      const key = normalizeTag(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const current = tags.get(key);
      if (current) current.count += 1;
      else tags.set(key, { name, key, count: 1 });
    }
  }
  return [...tags.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pt-BR'));
}

export function filterVideosByTags(videos, includedTags, excludedTags) {
  const included = new Set(includedTags.map(normalizeTag));
  const excluded = new Set(excludedTags.map(normalizeTag));
  return videos.filter((video) => {
    const ownTags = new Set(video.tags.map(normalizeTag));
    if (included.size && ![...included].some((tag) => ownTags.has(tag))) return false;
    if ([...excluded].some((tag) => ownTags.has(tag))) return false;
    return true;
  });
}

export function getMaxResolution(video) {
  const heights = Array.isArray(video.resolutionHeights) ? video.resolutionHeights.filter((height) => Number.isFinite(height) && height > 0) : [];
  return heights.length ? Math.max(...heights) : undefined;
}

export function filterVideosByMetadata(videos, { duration = 'all', quality = 'all' } = {}) {
  return videos.filter((video) => {
    const seconds = Number(video.duration);
    if (duration === 'under-5' && !(seconds >= 0 && seconds < 300)) return false;
    if (duration === '5-to-20' && !(seconds >= 300 && seconds <= 1200)) return false;
    if (duration === 'over-20' && !(seconds > 1200)) return false;
    const resolution = getMaxResolution(video);
    if (quality === 'hd' && !(resolution >= 720)) return false;
    if (quality === '1080p' && !(resolution >= 1080)) return false;
    if (quality === 'sd' && !(resolution > 0 && resolution < 720)) return false;
    if (quality === 'unknown' && resolution !== undefined) return false;
    return true;
  });
}

export function formatQuality(height) {
  if (!Number.isFinite(height) || height <= 0) return undefined;
  if (height >= 2160) return '4K';
  if (height >= 1080) return '1080P';
  if (height >= 720) return `${Math.round(height)}P HD`;
  return `${Math.round(height)}P`;
}

export function getVideoHost(video) {
  try { return new URL(video.url).hostname; } catch { return 'instância desconhecida'; }
}

export function getEmbedUrl(video) {
  const path = video.embedPath;
  if (typeof path !== 'string' || !path.startsWith('/videos/embed/') || path.startsWith('//') || path.includes('..') || path.includes('\\')) return undefined;
  try {
    const source = new URL(video.url);
    if (source.protocol !== 'https:' || source.username || source.password) return undefined;
    const embed = new URL(path, source.origin);
    let decodedPath;
    try { decodedPath = decodeURIComponent(embed.pathname); } catch { return undefined; }
    if (embed.protocol !== 'https:' || embed.origin !== source.origin || !decodedPath.startsWith('/videos/embed/') || decodedPath.split('/').includes('..')) return undefined;
    for (const key of [...embed.searchParams.keys()]) {
      if (key.toLocaleLowerCase('en-US').startsWith('autoplay')) embed.searchParams.delete(key);
    }
    return embed.href;
  } catch {
    return undefined;
  }
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  return hours
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`;
}

export function formatCount(value) {
  if (!Number.isFinite(value) || value < 0) return undefined;
  return new Intl.NumberFormat('pt-BR', { notation: value >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);
}

export function formatPublishedDate(value) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}
