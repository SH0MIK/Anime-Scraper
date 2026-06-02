const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
app.use(cors());
app.use(express.json());

// Use a Gogoanime mirror that is not blocked (try multiple)
const DOMAINS = [
  'https://gogoanime3.co',
  'https://gogoanime.gg',
  'https://gogoanime.pet'
];
let currentDomain = DOMAINS[0];

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

  for (const domain of DOMAINS) {
    try {
      const url = `${domain}/search.html?keyword=${encodeURIComponent(q)}`;
      console.log(`Trying: ${url}`);
      const html = await fetchHTML(url);
      const $ = cheerio.load(html);
      const results = [];
      $('.last_episodes .items li, .items li').each((i, el) => {
        const titleElem = $(el).find('.name a, a[href*="/category/"]');
        let title = titleElem.text().trim();
        let href = titleElem.attr('href');
        if (!href) {
          href = $(el).find('a').attr('href');
          title = $(el).find('a').text().trim();
        }
        const id = href ? href.replace('/category/', '').replace('/', '') : '';
        const image = $(el).find('img').attr('src');
        if (title && id) results.push({ id, title, session: id, poster: image });
      });
      if (results.length) {
        currentDomain = domain;
        return res.json(results.slice(0, 20));
      }
    } catch (err) {
      console.log(`Domain ${domain} search failed:`, err.message);
    }
  }
  res.json([]);
});

// Episodes
app.get('/episodes', async (req, res) => {
  const { session } = req.query;
  if (!session) return res.status(400).json({ error: 'Missing session' });

  for (const domain of DOMAINS) {
    try {
      const url = `${domain}/category/${session}`;
      const html = await fetchHTML(url);
      const $ = cheerio.load(html);
      const episodes = [];
      $('#episode_page a, .episode-list a').each((i, el) => {
        const epNum = parseInt($(el).text().trim());
        const epLink = $(el).attr('href');
        const epId = epLink ? epLink.split('/').pop() : '';
        if (!isNaN(epNum) && epId) episodes.push({ number: epNum, title: `Episode ${epNum}`, session: epId });
      });
      if (episodes.length) {
        episodes.sort((a,b) => a.number - b.number);
        return res.json({ episodes });
      }
    } catch (err) {}
  }
  res.json({ episodes: [] });
});

// Sources
app.get('/sources', async (req, res) => {
  const { ep_session } = req.query;
  if (!ep_session) return res.status(400).json({ error: 'Missing ep_session' });

  for (const domain of DOMAINS) {
    try {
      const episodeUrl = `${domain}/${ep_session}`;
      const html = await fetchHTML(episodeUrl);
      const $ = cheerio.load(html);
      let streamUrl = '';
      $('iframe').each((i, el) => {
        const src = $(el).attr('src');
        if (src && src.includes('streaming.php')) streamUrl = src;
      });
      if (!streamUrl) streamUrl = $('.play-video iframe').attr('src') || '';
      if (!streamUrl) continue;

      if (streamUrl.startsWith('//')) streamUrl = 'https:' + streamUrl;
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
      if (m3u8) return res.json([{ quality: 'auto', kwik_url: m3u8, audio: 'jpn' }]);
    } catch (err) {}
  }
  res.status(404).json({ error: 'No sources found' });
});

// Proxy endpoints
app.get('/proxy/m3u8', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).send('Missing url');
    const decoded = decodeURIComponent(url);
    const response = await axios.get(decoded, { responseType: 'text', headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 });
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
  res.json({ status: 'ok', service: 'Anime Scraper' });
});

module.exports = app;
