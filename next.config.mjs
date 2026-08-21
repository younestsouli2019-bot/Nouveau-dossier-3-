/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  experimental: {},
  serverExternalPackages: ['@prisma/client', 'prisma'],
};
export default nextConfig;

