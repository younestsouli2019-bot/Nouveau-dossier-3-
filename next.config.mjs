/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next.js 16: eslint config moved out of next.config — use next.config ESLint plugin or .eslintrc
  typescript: { ignoreBuildErrors: true },
  // Next.js 16: serverComponentsExternalPackages → serverExternalPackages
  serverExternalPackages: ['@prisma/client', 'prisma'],
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
