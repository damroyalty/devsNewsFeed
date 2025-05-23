process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
const { app, BrowserWindow, ipcMain } = require('electron');
const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const fs = require('fs');
const envPath = path.join(__dirname, '.env');




// API Configuration
const NEWS_API_CONFIG = {
  url: `${process.env.NEWS_API_URL}?q=stocks OR earnings&language=en&sortBy=publishedAt`,
  key: process.env.NEWS_API_KEY
};

const GNEWS_CONFIG = {
  url: `${process.env.GNEWS_API_URL}/search`,
  params: {
    q: 'earnings OR stocks',
    lang: 'en',
    country: 'us',
    max: 10,
    token: process.env.GNEWS_API_KEY
  }
};
const FMP_CONFIG = {
    baseUrl: process.env.FMP_API_URL,
    apiKey: process.env.FMP_API_KEY,
    endpoints: {
      search: (query) => `${FMP_CONFIG.baseUrl}/search?query=${query}&apikey=${FMP_CONFIG.apiKey}`,
      stockNews: (tickers) => `${FMP_CONFIG.baseUrl}/stock_news?tickers=${tickers}&limit=10&apikey=${FMP_CONFIG.apiKey}`,
      earnings: () => `${FMP_CONFIG.baseUrl}/earning_calendar?apikey=${FMP_CONFIG.apiKey}`
    }
  };
  
  
  // Fallback image URL
  const FALLBACK_IMAGE = 'https://preview.redd.it/where-is-uuh-from-does-anyone-know-the-origin-v0-bm1xva9aq59c1.gif';
  
  async function fetchFMPData(endpoint, params = {}) {
    let url;
    try {
      url = typeof endpoint === 'function' ? endpoint(params) : endpoint;
      const { data } = await axios.get(url, { timeout: 5000 });
      return data;
    } catch (error) {
      console.error(`FMP API Error (${url}):`, error.message);
      return null;
    }
  }
  
  // Normalize all news articles to consistent format
  function normalizeArticle(article) {
    return {
      title: article.title || 'No title available',
      description: article.text || '',
      url: article.url || '#',
      urlToImage: article.image || FALLBACK_IMAGE,
      publishedAt: article.publishedDate || new Date().toISOString(),
      source: { name: article.site || 'Financial Modeling Prep' }
    };
  }

function createWindow() {
  const win = new BrowserWindow({
    width: 440,
    height: 875,
    icon: path.join(__dirname, 'assets', 'cat-news.ico'),
    frame: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      enableRemoteModule: false,
    }
  });

  // Block requests to unwanted domains
  const blockedDomains = [
    '*://ad.*/*',
    '*://track.*/*',
    '*://*.omnitagjs.com/*',
    '*://audienceexposure.com/*'
  ];
  
  win.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: ['*://*/*'] },
    (details, callback) => {
      console.log('Request:', details.url);
      callback({ requestHeaders: details.requestHeaders });
    }
  );

  win.loadFile('index.html');
}

// News API Fetch Function
async function fetchNewsAPI() {
  try {
    const { data } = await axios.get(`${NEWS_API_CONFIG.url}&apiKey=${NEWS_API_CONFIG.key}`);
    return data;
  } catch (error) {
    console.error('NewsAPI Error:', error.message);
    return { articles: [], error: 'NewsAPI failed' };
  }
}

// GNews Fetch Function
async function fetchGNews() {
  try {
    const { data } = await axios.get(GNEWS_CONFIG.url, { params: GNEWS_CONFIG.params });
    return {
      articles: data.articles.map(article => ({
        title: article.title,
        description: article.description,
        url: article.url,
        urlToImage: article.image || null,
        publishedAt: article.publishedAt,
        source: { name: article.source.name }
      }))
    };
  } catch (error) {
    console.error('GNews Error:', error.message);
    return { articles: [], error: 'GNews failed' };
  }
}

// Unified News Handler
ipcMain.handle('get-news', async () => {
  try {
    const [newsApiData, gnewsData] = await Promise.all([
      fetchNewsAPI(),
      fetchGNews()
    ]);

    // Combine and sort articles by date (newest first)
    const combinedArticles = [
      ...(newsApiData.articles || []),
      ...(gnewsData.articles || [])
    ].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    return { articles: combinedArticles };
  } catch (error) {
    console.error('Combined News Error:', error);
    return { error: 'Failed to fetch from all news sources' };
  }
});

// App Lifecycle
app.whenReady().then(() => {
    app.commandLine.appendSwitch('ignore-certificate-errors'); // Dev only - remove for production
    createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('get-news-data', async (event, query = 'stocks OR market') => {
  try {
    const response = await axios.get('https://newsapi.org/v2/everything', {
      params: {
        q: query,
        apiKey: process.env.NEWS_API_KEY,
        language: 'en',
        sortBy: 'publishedAt',
        pageSize: 10
      },
      timeout: 5000
    });

    // Transform the response to include sentiment analysis
    const articlesWithSentiment = response.data.articles.map(article => ({
      ...article,
      sentiment: analyzeSentiment(article.title),
      source: article.source?.name || 'Unknown'
    }));

    return {
      status: response.status,
      articles: articlesWithSentiment
    };
  } catch (error) {
    console.error('NewsAPI Error:', error.response?.data || error.message);
    return {
      error: {
        message: error.message,
        code: error.code,
        status: error.response?.status
      },
      articles: []
    };
  }
});

// Simple sentiment analysis helper
function analyzeSentiment(text) {
  const positive = ['up', 'rise', 'gain', 'bullish', 'beat', 'surge'];
  const negative = ['down', 'fall', 'drop', 'bearish', 'miss', 'plunge'];
  
  const score = text.split(/\s+/).reduce((acc, word) => {
    const lowerWord = word.toLowerCase();
    if (positive.includes(lowerWord)) return acc + 1;
    if (negative.includes(lowerWord)) return acc - 1;
    return acc;
  }, 0);

  return score > 0 ? '📈' : score < 0 ? '📉' : '➖';
}

ipcMain.handle('search-news', async (event, query) => {
  try {
    const response = await axios.get('https://newsapi.org/v2/everything', {
      params: {
        q: query,
        apiKey: process.env.NEWS_API_KEY,
        language: 'en',
        pageSize: 20
      },
      timeout: 10000
    });

    return {
      status: 'success',
      articles: response.data.articles.map(article => ({
        title: article.title,
        description: article.description,
        url: article.url,
        urlToImage: article.urlToImage,
        publishedAt: article.publishedAt,
        source: article.source?.name || 'Unknown',
        sentiment: analyzeSentiment(article.title)
      }))
    };
  } catch (error) {
    console.error('Search Error:', error.message);
    return {
      status: 'error',
      message: error.response?.data?.message || error.message,
      articles: []
    };
  }
});

function analyzeSentiment(text) {
  const positive = ['up', 'rise', 'gain', 'bullish', 'beat', 'surge'];
  const negative = ['down', 'fall', 'drop', 'bearish', 'miss', 'plunge'];
  
  const score = text.toLowerCase().split(/\s+/).reduce((acc, word) => {
    if (positive.includes(word)) return acc + 1;
    if (negative.includes(word)) return acc - 1;
    return acc;
  }, 0);
  
  return score > 0 ? '📈' : score < 0 ? '📉' : '➖';
}

