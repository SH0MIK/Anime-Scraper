const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
app.use(cors());
app.use(express.json());

const BASE_URL = 'https://animekhor.org';

async function fetchHTML(url) {
  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    },
    timeout: 15000,
  });
  return response.data;
}

// Search
app.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Missing q' });
  try {
    const url = `${BASE_URL}/search?keyword=${encodeURIComponent(q)}`;
    const html = await fetchHTML(url);
    const $ = cheerio.load(html);
    const results = [];
    $('.anime-grid .anime-item, .film-grid .film-item').each((i, el) => {
      const title = $(el).find('h3, .film-title').text().trim();
      const link = $(el).find('a').attr('href');
      const id = link ? link.split('/')[2] : '';
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
  const { session } = req.query;
  if (!session) return res.status(400).json({ error: 'Missing session' });
  try {
    const url = `${BASE_URL}/anime/${session}`;
    const html = await fetchHTML(url);
    const $ = cheerio.load(html);
    const episodes = [];
    $('.episodes-list a, .episode-item a').each((i, el) => {
      const epNum = parseInt($(el).find('.ep-num, .episode-number').text().trim() || $(el).text().trim());
      const epLink = $(el).attr('href');
      const epId = epLink ? epLink.split('/').pop() : '';
      if (!isNaN(epNum) && epId) episodes.push({ number: epNum, title: `Episode ${epNum}`, session: epId });
    });
    episodes.sort((a,b) => a.number - b.number);
    res.json({ episodes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sources
app.get('/sources', async (req, res) => {
  const { ep_session } = req.query;
  if (!ep_session) return res.status(400).json({ error: 'Missing ep_session' });
  try {
    const url = `${BASE_URL}/watch/${ep_session}`;
    const html = await fetchHTML(url);
    const $ = cheerio.load(html);
    let streamUrl = '';
    // Find the iframe that contains the video
    $('iframe').each((i, el) => {
      const src = $(el).attr('src');
      if (src && (src.includes('vidsrc') || src.includes('embed') || src.includes('drive'))) {
        streamUrl = src;
        return false;
      }
    });
    if (!streamUrl) {
      const videoSrc = $('video source').attr('src');
      if (videoSrc) {
        return res.json([{ quality: 'auto', kwik_url: videoSrc, audio: 'jpn' }]);
      }
      return res.status(404).json({ error: 'No video source found' });
    }
    if (streamUrl.startsWith('//')) streamUrl = 'https:' + streamUrl;
    // The iframe may contain an m3u8 directly
    if (streamUrl.includes('.m3u8')) {
      return res.json([{ quality: 'auto', kwik_url: streamUrl, audio: 'jpn' }]);
    }
    // Fetch the iframe content to extract m3u8
    const frameHtml = await fetchHTML(streamUrl);
    const $frame = cheerio.load(frameHtml);
    let m3u8 = '';
    $frame('script').each((i, script) => {
      const content = $(script).html();
      if (content) {
        const match = content.match(/file:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
        if (match) m3u8 = match[1];
      }
    });
    if (!m3u8) {
      const directVideo = $frame('video source').attr('src');
      if (directVideo) m3u8 = directVideo;
    }
    if (!m3u8) return res.status(404).json({ error: 'No m3u8 found' });
    res.json([{ quality: 'auto', kwik_url: m3u8, audio: 'jpn' }]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Proxy endpoints (same as before)
app.get('/proxy/m3u8', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).send('Missing url');
    const decoded = decodeURIComponent(url);
    const response = await axios.get(decoded, { responseType: 'text', timeout: 15000 });
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Anime Scraper (AnimeKhor)' });
});

module.exports = app;
