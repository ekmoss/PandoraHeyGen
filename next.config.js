/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  swcMinify: true,
  // Disable image optimization if not needed to reduce build complexity
  images: {
    unoptimized: true
  }
}

module.exports = nextConfig
