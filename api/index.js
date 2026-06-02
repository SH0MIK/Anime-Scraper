const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
app.use(cors());
app.use(express.json());

// Helper to fetch HTML
async function fetchHTML(url) {
  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    timeout: 15000,
  });
  return response.data;
}

// Search
app.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'Missing q' });
    const url = `https://gogoanime.gg/search.html?keyword=${encodeURIComponent(q)}`;
    const html = await fetchHTML(url);
    const $ = cheerio.load(html);
    const results = [];
    $('.last_episodes .items li').each((i, el) => {
      const title = $(el).find('.name a').text().trim();
      const href = $(el).find('.name a').attr('href');
      const id = href ? href.replace('/category/', '') : '';
      const image = $(el).find('img').attr('src');
      if (title && id) results.push({ id, title, session: id, poster: image });
    });
    res.json(results.slice(0, 20));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Episodes
app.get('/episodes', async (req, res) => {
  try {
    const { session } = req.query;
    if (!session) return res.status(400).json({ error: 'Missing session' });
    const url = `https://gogoanime.gg/category/${session}`;
    const html = await fetchHTML(url);
    const $ = cheerio.load(html);
    const episodes = [];
    $('#episode_page a').each((i, el) => {
      const epNum = parseInt($(el).text().trim());
      const epLink = $(el).attr('href');
      const epId = epLink ? epLink.split('/').pop() : '';
      if (epNum && epId) episodes.push({ number: epNum, title: `Episode ${epNum}`, session: epId });
    });
    episodes.reverse();
    res.json({ episodes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sources
app.get('/sources', async (req, res) => {
  try {
    const { ep_session } = req.query;
    if (!ep_session) return res.status(400).json({ error: 'Missing ep_session' });
    const episodeUrl = `https://gogoanime.gg/${ep_session}`;
    const html = await fetchHTML(episodeUrl);
    const $ = cheerio.load(html);
    let streamUrl = '';
    $('iframe').each((i, el) => {
      const src = $(el).attr('src');
      if (src && src.includes('streaming.php')) streamUrl = src;
    });
    if (!streamUrl) {
      const fallback = $('.play-video iframe').attr('src');
      if (fallback) streamUrl = fallback;
    }
    if (!streamUrl) return res.status(404).json({ error: 'No streaming iframe' });
    const streamHtml = await fetchHTML(streamUrl);
    const $stream = cheerio.load(streamHtml);
    let m3u8 = '';
    $stream('script').each((i, script) => {
      const content = $(script).html();
      if (content && content.includes('file:')) {
        const match = content.match(/file:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
        if (match) m3u8 = match[1];
      }
    });
    if (!m3u8) return res.status(404).json({ error: 'No m3u8 found' });
    res.json([{ quality: 'auto', kwik_url: m3u8, audio: 'jpn' }]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Proxy m3u8
app.get('/proxy/m3u8', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).send('Missing url');
    const decoded = decodeURIComponent(url);
    const response = await axios.get(decoded, {
      responseType: 'text',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 15000,
    });
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Proxy segment
app.get('/proxy/segment', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).send('Missing url');
    const decoded = decodeURIComponent(url);
    const response = await axios.get(decoded, { responseType: 'arraybuffer', timeout: 30000 });
    res.setHeader('Content-Type', 'video/mp2t');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(Buffer.from(response.data));
  } catch (err) {
    res.status(502).send('Segment failed');
  }
});

// Root route for health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Anime Scraper (Vercel)' });
});

// Export for Vercel
module.exports = app;
