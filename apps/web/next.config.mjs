/** @type {import('next').NextConfig} */
const nextConfig = {
  // API proxy: forward /api/v1/* to the NestJS backend
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'}/api/v1/:path*`,
      },
    ];
  },

  async headers() {
    return [
      {
        // tracker.js — loaded once by every restaurant's website.
        // 1h cache: browsers refresh hourly, hotfixes propagate within 60 min.
        source: '/tracker.js',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=3600, stale-while-revalidate=600' },
        ],
      },
    ];
  },
};

export default nextConfig;
