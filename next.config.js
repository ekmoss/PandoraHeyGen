/** @type {import('next').NextConfig} */
const nextConfig = {
  // Remove 'standalone' output
  // output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  swcMinify: true,
  // Disable image optimization if not needed to reduce build complexity
  images: {
    unoptimized: true
  },
  // Add this to disable ESLint during builds
  eslint: {
    ignoreDuringBuilds: true
  }
}

module.exports = nextConfig
