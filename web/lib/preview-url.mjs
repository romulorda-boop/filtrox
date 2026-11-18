export function safeXvideosUrl(value, item) {
  if (!item || item.source !== 'xvideos' || typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
    const allowedHost = host === 'xvideos.com' || host.endsWith('.xvideos.com');
    if (parsed.protocol !== 'https:' || !allowedHost || parsed.username || parsed.password || !['', '443'].includes(parsed.port)) return null;
    return parsed.href;
  } catch {
    return null;
  }
}
