/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client', 'prisma'],
  },
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          ...((config.watchOptions && config.watchOptions.ignored) || []),
          '**/C:/DumpStack.log.tmp',
          '**/C:/pagefile.sys',
          '**/C:/swapfile.sys',
        ],
      };
    }
    return config;
  },
};
export default nextConfig;
