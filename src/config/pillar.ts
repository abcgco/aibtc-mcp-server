// Pillar API configuration
export const PILLAR_API_URL = process.env.PILLAR_API_URL || "https://pillar-be.vercel.app";
// Public default key: rate-limited per IP on the backend, same model as Hiro's public API tier.
// Set PILLAR_API_KEY env var for higher limits.
export const PILLAR_API_KEY = process.env.PILLAR_API_KEY || "jc_b058d7f2e0976bd4ee34be3e5c7ba7ebe45289c55d3f5e45f666ebc14b7ebfd0";
