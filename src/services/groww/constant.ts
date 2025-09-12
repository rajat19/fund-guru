export const BASE_URL = 'https://groww.in/v1/api';
export const DERIVED_SCHEME_URL = `${BASE_URL}/search/v1/derived/scheme`;
export const SCHEME_STATS_URL = `${BASE_URL}/data/mf/web/v1/scheme/portfolio/{scheme_code}/stats`;
export const MF_SEARCH_API = `${BASE_URL}/data/mf/web/v4/scheme/search/{search_id}`;

export const DEFAULT_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'en-GB,en;q=0.6',
};

// Add delay to avoid rate limiting
export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
