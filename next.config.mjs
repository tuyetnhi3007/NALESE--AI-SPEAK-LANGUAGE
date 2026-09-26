/** @type {import('next').NextConfig} */
const nextConfig = {
  // Vercel deployment: moved from experimental in Next.js 15+
  // serverExternalPackages replaces experimental.serverComponentsExternalPackages
  serverExternalPackages: ['openai', 'xlsx'],

  // Note: API body size limits are now configured per-route via
  // the `export const config` object in Next.js App Router.
  // See each API route file for individual size configurations.
};

export default nextConfig;
