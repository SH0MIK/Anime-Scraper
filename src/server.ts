import express from 'express';
import cors from 'cors';
import axios from 'axios';
import * as cheerio from 'cheerio';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ---------- Helper: fetch HTML with browser headers ----------
async function fetchHTML(url: string): Promise<string> {
  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    },
    timeout: 15000,
  });
  return response.data;
}

// ---------- Endpoint 1: Search anime ----------
app.get('/search', async (req, res) => {
  try {
    const keyword = req.query.q;
    if (!keyword) return res.status(400).json({ error: 'Missing ?q' });

    const url = `https://gogoanime.gg/search.html?keyword=${encodeURIComponent(keyword as string)}`;
    const html = await fetchHTML(url);
    const $ = cheerio.load(html);
    const results: any[] = [];

    $('.last_episodes .items li').each((i, el) => {
      const title = $(el).find('.name a').text().trim();
      const link = $(el).find('.name a').attr('href');
      const id = link ? link.replace('/category/', '') : '';
      const image = $(el).find('img').attr('src');
      if (title && id) {
        results.push({ id, title, session: id, poster: image });
      }
    });

    res.json(results.slice(0, 20));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ---------- Endpoint 2: Get episodes for an anime ----------
app.get('/episodes', async (req, res) => {
  try {
    const animeId = req.query.session;
    if (!animeId) return res.status(400).json({ error: 'Missing session' });

    const url = `https://gogoanime.gg/category/${animeId}`;
    const html = await fetchHTML(url);
    const $ = cheerio.load(html);
    const episodes: any[] = [];

    $('#episode_page a').each((i, el) => {
      const epNum = parseInt($(el).text().trim());
      const epLink = $(el).attr('href');
      const epId = epLink ? epLink.split('/').pop() : '';
      if (epNum && epId) {
        episodes.push({ number: epNum, title: `Episode ${epNum}`, session: epId });
      }
    });

    // Reverse so episode 1 comes first
    res.json({ episodes: episodes.reverse() });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ---------- Endpoint 3: Get video source (m3u8) for an episode ----------
app.get('/sources', async (req, res) => {
  try {
    const episodeId = req.query.ep_session;
    if (!episodeId) return res.status(400).json({ error: 'Missing ep_session' });

    // Step 1: fetch the episode page
    const episodeUrl = `https://gogoanime.gg/${episodeId}`;
    const html = await fetchHTML(episodeUrl);
    const $ = cheerio.load(html);

    // Find the iframe that points to the streaming server
    let streamUrl = '';
    $('iframe').each((i, el) => {
      const src = $(el).attr('src');
      if (src && src.includes('streaming.php')) {
        streamUrl = src;
        return false;
      }
    });

    if (!streamUrl) {
      // Fallback: look for the main player iframe
      const iframe = $('.play-video iframe').attr('src');
      if (iframe) streamUrl = iframe;
    }

    if (!streamUrl) {
      return res.status(404).json({ error: 'No video iframe found' });
    }

    // Step 2: fetch the streaming page to extract the m3u8 URL
    const streamHtml = await fetchHTML(streamUrl);
    const $stream = cheerio.load(streamHtml);
    let m3u8Url = '';

    $stream('script').each((i, script) => {
      const content = $(script).html();
      if (content && content.includes('file:')) {
        const match = content.match(/file:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
        if (match) {
          m3u8Url = match[1];
          return false;
        }
      }
    });

    if (!m3u8Url) {
      return res.status(404).json({ error: 'No m3u8 URL found' });
    }

    res.json([{ quality: 'auto', kwik_url: m3u8Url, audio: 'jpn' }]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ---------- Proxy endpoint for m3u8 and segments ----------
app.get('/proxy/m3u8', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).send('Missing url');
    const decoded = decodeURIComponent(url as string);
    const response = await axios.get(decoded, {
      responseType: 'text',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 15000,
    });
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(response.data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/proxy/segment', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).send('Missing url');
    const decoded = decodeURIComponent(url as string);
    const response = await axios.get(decoded, {
      responseType: 'arraybuffer',
      timeout: 30000,
    });
    res.setHeader('Content-Type', 'video/mp2t');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(Buffer.from(response.data));
  } catch (error: any) {
    res.status(502).send('Segment failed');
  }
});

// ---------- Start server ----------
app.listen(PORT, () => {
  console.log(`✅ Anime scraper running on port ${PORT}`);
});
