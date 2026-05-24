// Use Vite proxy in dev mode to avoid CORS, direct URL for CLI/production
const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV;
export const BASE_URL = isDev ? '/api/groww' : 'https://groww.in/v1/api';

export const DERIVED_SCHEME_URL = `${BASE_URL}/search/v1/derived/scheme`;
export const SCHEME_STATS_URL = `${BASE_URL}/data/mf/web/v1/scheme/portfolio/{scheme_code}/stats`;
export const MF_SEARCH_API = `${BASE_URL}/data/mf/web/v4/scheme/search/{search_id}`;

export const DEFAULT_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'en-GB,en;q=0.6',
};

// Add delay to avoid rate limiting
export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
