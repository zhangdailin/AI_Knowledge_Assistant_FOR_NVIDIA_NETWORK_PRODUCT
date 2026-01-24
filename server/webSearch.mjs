const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_RESULTS = 5;
const DEFAULT_MAX_SNIPPET = 300;

function sanitizeString(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
}

function truncateText(text, maxLen) {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}...`;
}

function normalizeProviderName(value) {
  if (!value) return '';
  return String(value).toLowerCase().trim();
}

function getSearchSettings(settings = {}) {
  const providerSetting = normalizeProviderName(
    settings?.providers?.search?.provider || process.env.SEARCH_PROVIDER
  );

  return {
    provider: providerSetting,
    serper: {
      apiKey: settings?.providers?.search?.serperApiKey || process.env.SERPER_API_KEY,
      baseUrl: settings?.providers?.search?.serperBaseUrl || process.env.SERPER_BASE_URL || 'https://google.serper.dev',
      hl: settings?.providers?.search?.serperHl || process.env.SERPER_HL || 'en',
      gl: settings?.providers?.search?.serperGl || process.env.SERPER_GL || 'us'
    },
    bing: {
      apiKey: settings?.providers?.search?.bingApiKey || process.env.BING_SEARCH_KEY,
      endpoint: settings?.providers?.search?.bingEndpoint || process.env.BING_SEARCH_ENDPOINT || 'https://api.bing.microsoft.com/v7.0/search',
      mkt: settings?.providers?.search?.bingMarket || process.env.BING_SEARCH_MARKET || 'en-US'
    },
    brave: {
      apiKey: settings?.providers?.search?.braveApiKey || process.env.BRAVE_SEARCH_API_KEY,
      endpoint: settings?.providers?.search?.braveEndpoint || process.env.BRAVE_SEARCH_ENDPOINT || 'https://api.search.brave.com/res/v1/web/search',
      lang: settings?.providers?.search?.braveSearchLang || process.env.BRAVE_SEARCH_LANG || 'en'
    }
  };
}

function getProviderOrder(preferred) {
  if (preferred) return [preferred];
  return ['serper', 'bing', 'brave'];
}

async function fetchWithTimeout(url, options, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function searchWithSerper(query, config, maxResults) {
  if (!config?.apiKey) return null;
  const url = `${config.baseUrl.replace(/\/$/, '')}/search`;
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': config.apiKey
    },
    body: JSON.stringify({
      q: query,
      num: maxResults,
      hl: config.hl,
      gl: config.gl
    })
  });

  if (!response.ok) {
    throw new Error(`Serper search failed: ${response.status}`);
  }

  const data = await response.json();
  const items = Array.isArray(data?.organic) ? data.organic : [];
  return items.map(item => ({
    title: sanitizeString(item?.title),
    url: sanitizeString(item?.link),
    snippet: truncateText(sanitizeString(item?.snippet), DEFAULT_MAX_SNIPPET)
  })).filter(item => item.title || item.url || item.snippet);
}

async function searchWithBing(query, config, maxResults) {
  if (!config?.apiKey) return null;
  const params = new URLSearchParams({
    q: query,
    count: String(maxResults),
    mkt: config.mkt
  });
  const response = await fetchWithTimeout(`${config.endpoint}?${params.toString()}`, {
    method: 'GET',
    headers: {
      'Ocp-Apim-Subscription-Key': config.apiKey
    }
  });

  if (!response.ok) {
    throw new Error(`Bing search failed: ${response.status}`);
  }

  const data = await response.json();
  const items = Array.isArray(data?.webPages?.value) ? data.webPages.value : [];
  return items.map(item => ({
    title: sanitizeString(item?.name),
    url: sanitizeString(item?.url),
    snippet: truncateText(sanitizeString(item?.snippet), DEFAULT_MAX_SNIPPET)
  })).filter(item => item.title || item.url || item.snippet);
}

async function searchWithBrave(query, config, maxResults) {
  if (!config?.apiKey) return null;
  const params = new URLSearchParams({
    q: query,
    count: String(maxResults),
    search_lang: config.lang
  });
  const response = await fetchWithTimeout(`${config.endpoint}?${params.toString()}`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'X-Subscription-Token': config.apiKey
    }
  });

  if (!response.ok) {
    throw new Error(`Brave search failed: ${response.status}`);
  }

  const data = await response.json();
  const items = Array.isArray(data?.web?.results) ? data.web.results : [];
  return items.map(item => ({
    title: sanitizeString(item?.title),
    url: sanitizeString(item?.url),
    snippet: truncateText(sanitizeString(item?.description), DEFAULT_MAX_SNIPPET)
  })).filter(item => item.title || item.url || item.snippet);
}

export async function runWebSearch(query, settings = {}, options = {}) {
  const normalizedQuery = sanitizeString(query);
  if (!normalizedQuery) return null;

  const maxResults = Number.isFinite(options.maxResults) ? options.maxResults : DEFAULT_MAX_RESULTS;
  const config = getSearchSettings(settings);
  const providers = getProviderOrder(config.provider);

  let lastError = null;
  for (const provider of providers) {
    try {
      if (provider === 'serper') {
        const results = await searchWithSerper(normalizedQuery, config.serper, maxResults);
        if (results && results.length) return { provider, results };
      }
      if (provider === 'bing') {
        const results = await searchWithBing(normalizedQuery, config.bing, maxResults);
        if (results && results.length) return { provider, results };
      }
      if (provider === 'brave') {
        const results = await searchWithBrave(normalizedQuery, config.brave, maxResults);
        if (results && results.length) return { provider, results };
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    console.warn('[WebSearch] All providers failed:', lastError.message);
  }
  return null;
}

export function buildSearchContext(searchPayload, maxChars = 4000) {
  if (!searchPayload || !Array.isArray(searchPayload.results) || searchPayload.results.length === 0) {
    return '';
  }

  const providerLabel = searchPayload.provider ? ` (${searchPayload.provider})` : '';
  let content = `Web search results${providerLabel}:\n`;
  for (let i = 0; i < searchPayload.results.length; i += 1) {
    const result = searchPayload.results[i];
    const title = result.title || 'Untitled';
    const url = result.url || '';
    const snippet = result.snippet || '';
    const block = `[${i + 1}] ${title}\nURL: ${url}\nSnippet: ${snippet}\n\n`;
    if ((content + block).length > maxChars) break;
    content += block;
  }
  return content.trim();
}
