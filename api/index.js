const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

const API_BASE = 'https://api.consumet.org/anime/gogoanime';

// Search
app.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Missing q' });
  try {
    const { data } = await axios.get(`${API_BASE}/search?keyw=${encodeURIComponent(q)}`);
    const results = data.results.map(anime => ({
      id: anime.id,
      title: anime.title,
      session: anime.id,
      poster: anime.image
    }));
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Episodes
app.get('/episodes', async (req, res) => {
  const { session } = req.query;
  if (!session) return res.status(400).json({ error: 'Missing session' });
  try {
    const { data } = await axios.get(`${API_BASE}/info/${session}`);
    const episodes = data.episodes.map(ep => ({
      number: ep.number,
      title: ep.title || `Episode ${ep.number}`,
      session: ep.id
    }));
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
    const { data } = await axios.get(`${API_BASE}/watch/${ep_session}`);
    const sources = data.sources.map(s => ({
      quality: s.quality,
      kwik_url: s.url,
      audio: 'jpn'
    }));
    res.json(sources);
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
    const { data } = await axios.get(decoded, { responseType: 'text', timeout: 15000 });
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(data);
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

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Anime Scraper' });
});

module.exports = app;
