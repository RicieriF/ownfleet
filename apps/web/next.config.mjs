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
};

export default nextConfig;
