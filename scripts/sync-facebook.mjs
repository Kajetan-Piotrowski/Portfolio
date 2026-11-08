import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const PAGE_ID = process.env.META_PAGE_ID?.trim();
const ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN?.trim();
const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION?.trim() || 'v27.0';
const MAX_POSTS = Math.min(500, Math.max(1, Number.parseInt(process.env.META_MAX_POSTS || '100', 10) || 100));
const OUTPUT = resolve('aktualnosci/articles.json');

const FIELDS = [
  'id',
  'message',
  'story',
  'created_time',
  'permalink_url',
  'full_picture',
  'attachments{media_type,media,subattachments{media_type,media}}'
].join(',');

if (!PAGE_ID || !ACCESS_TOKEN) {
  console.warn('META_PAGE_ID lub META_PAGE_ACCESS_TOKEN nie jest ustawiony. Synchronizacja pominięta.');
  process.exit(0);
}

if (!/^v\d+\.0$/.test(GRAPH_VERSION)) {
  throw new Error(`Nieprawidłowa wersja Graph API: ${GRAPH_VERSION}`);
}

function safeHttpsUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function collectImages(post) {
  const images = new Set();
  const add = value => {
    const url = safeHttpsUrl(value);
    if (url) images.add(url);
  };
  add(post.full_picture);

  const attachments = post.attachments?.data ?? [];
  for (const attachment of attachments) {
    add(attachment.media?.image?.src);
    const children = attachment.subattachments?.data ?? [];
    for (const child of children) add(child.media?.image?.src);
  }
  return [...images].slice(0, 12);
}

function makeTitle(text, hasImages) {
  if (!text) return hasImages ? 'Publikacja zdjęciowa' : 'Aktualność z Facebooka';
  const firstLine = text.split(/\r?\n/).map(line => line.trim()).find(Boolean) || text;
  const sentence = firstLine.match(/^.{1,110}?[.!?](?:\s|$)/u)?.[0]?.trim();
  let title = firstLine.length <= 90 ? firstLine : (sentence || `${firstLine.slice(0, 87).trimEnd()}…`);
  return title.replace(/\s+/g, ' ').trim();
}

function makeExcerpt(text, title, hasImages) {
  const remaining = text.startsWith(title) ? text.slice(title.length).trim() : text;
  const candidate = remaining || text || (hasImages ? 'Fotorelacja opublikowana na stronie Facebook.' : 'Nowa publikacja na stronie Facebook.');
  return candidate.length > 210 ? `${candidate.slice(0, 207).trimEnd()}…` : candidate;
}

function normalizePost(post) {
  const text = String(post.message || post.story || '').replace(/\u0000/g, '').trim();
  const images = collectImages(post);
  if (!text && images.length === 0) return null;

  const title = makeTitle(text, images.length > 0);
  const firstLine = text.split(/\r?\n/).map(line => line.trim()).find(Boolean) || '';
  const content = firstLine && firstLine === title
    ? text.slice(text.indexOf(firstLine) + firstLine.length).trim()
    : text;

  return {
    id: String(post.id),
    title,
    excerpt: makeExcerpt(text, title, images.length > 0),
    content,
    publishedAt: post.created_time || null,
    permalink: safeHttpsUrl(post.permalink_url),
    image: images[0] || null,
    images,
    source: 'Facebook'
  };
}

async function graphGet(path, params = {}) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    signal: AbortSignal.timeout(30_000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) {
    const code = payload.error?.code ? `, kod ${payload.error.code}` : '';
    const message = payload.error?.message || `HTTP ${response.status}`;
    throw new Error(`Meta Graph API: ${message}${code}`);
  }
  return payload;
}

async function fetchRecentPosts() {
  const posts = [];
  let after;
  while (posts.length < MAX_POSTS) {
    const limit = Math.min(100, MAX_POSTS - posts.length);
    const payload = await graphGet(`${encodeURIComponent(PAGE_ID)}/posts`, {
      fields: FIELDS,
      limit,
      ...(after ? { after } : {})
    });
    posts.push(...(payload.data || []));
    after = payload.paging?.cursors?.after;
    if (!after || !(payload.data || []).length) break;
  }
  return posts;
}

async function readExisting() {
  try {
    const parsed = JSON.parse(await readFile(OUTPUT, 'utf8'));
    return {
      pageName: parsed.pageName || null,
      generatedAt: parsed.generatedAt || null,
      articles: Array.isArray(parsed.articles) ? parsed.articles : []
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { pageName: null, generatedAt: null, articles: [] };
  }
}

const pageDetails = await graphGet(encodeURIComponent(PAGE_ID), { fields: 'name' });
const rawPosts = await fetchRecentPosts();
const newArticles = rawPosts.map(normalizePost).filter(Boolean);
const existing = await readExisting();
const merged = new Map(existing.articles.map(article => [String(article.id), article]));
for (const article of newArticles) merged.set(article.id, article);

const articles = [...merged.values()]
  .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
  .slice(0, 250);

const output = {
  pageName: pageDetails.name || existing.pageName || 'Facebook',
  generatedAt: existing.generatedAt,
  articles
};

const oldComparable = JSON.stringify({ pageName: existing.pageName, articles: existing.articles });
const newComparable = JSON.stringify({ pageName: output.pageName, articles: output.articles });
if (oldComparable === newComparable) {
  console.log(`Synchronizacja zakończona. Brak zmian; sprawdzono ${rawPosts.length} publikacji.`);
} else {
  output.generatedAt = new Date().toISOString();
  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(`Zapisano ${articles.length} artykułów. Nowe lub zaktualizowane posty: ${newArticles.length}.`);
}
