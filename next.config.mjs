/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client', 'prisma'],
  },
  webpack: (config, { dev }) => {
    if (dev) {
      const existing = config.watchOptions && config.watchOptions.ignored;
      const base = Array.isArray(existing) ? existing : existing ? [existing] : [];
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          ...base,
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
