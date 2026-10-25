/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Next.js 16: eslint config moved out of next.config — use next.config ESLint plugin or .eslintrc
  typescript: { ignoreBuildErrors: true },
  // Next.js 16: serverComponentsExternalPackages → serverExternalPackages
  serverExternalPackages: ['@prisma/client', 'prisma', '@prisma/adapter-better-sqlite3', '@prisma/adapter-pg', 'better-sqlite3', 'pg'],
  // Next.js 16: Turbopack is default — declare empty config to acknowledge webpack config coexists
  turbopack: {},
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
