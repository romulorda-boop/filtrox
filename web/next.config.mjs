/** @type {import('next').NextConfig} */
const apiOrigin = (process.env.FILTROX_API_ORIGIN ?? '').trim().replace(/\/$/, '');

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    if (!apiOrigin) return [];
    return [
      { source: '/v1/:path*', destination: `${apiOrigin}/v1/:path*` },
      { source: '/healthz', destination: `${apiOrigin}/healthz` },
    ];
  },
};

export default nextConfig;
