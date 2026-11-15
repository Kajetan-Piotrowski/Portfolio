import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const PAGE_ID = process.env.META_PAGE_ID?.trim() || '1278602295344113';
const ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN?.trim();
const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION?.trim() || 'v27.0';
const MAX_POSTS = Math.min(600, Math.max(1, Number.parseInt(process.env.META_MAX_POSTS || '600', 10) || 600));
const OUTPUT = resolve('aktualnosci/articles.json');
const MEDIA_DIR = resolve('assets/aktualnosci');
const MEDIA_PREFIX = 'assets/aktualnosci/';
const MAX_IMAGES_PER_ARTICLE = 18;
const MAX_IMAGE_DOWNLOADS_PER_RUN = 60;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const FIELDS = [
  'id',
  'message',
  'story',
  'created_time',
  'permalink_url',
  'full_picture',
  'attachments{media_type,media,subattachments.limit(18){media_type,media}}'
].join(',');

if (!PAGE_ID || !ACCESS_TOKEN) {
  const message = 'Brak META_PAGE_ID lub META_PAGE_ACCESS_TOKEN. Nie pobrano nowych publikacji; zachowano dotychczasowe archiwum.';
  console.log(`::warning title=Synchronizacja Facebooka pominięta::${message}`);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, 'status=missing_credentials\\n');
  }
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
  return [...images].slice(0, MAX_IMAGES_PER_ARTICLE);
}

function makeTitle(text, hasImages, attachmentTypes = []) {
  if (!text) {
    if (hasImages) return 'Publikacja zdjęciowa';
    if (attachmentTypes.includes('video')) return 'Publikacja wideo';
    if (attachmentTypes.includes('link')) return 'Udostępniony link';
    if (attachmentTypes.includes('album')) return 'Album zdjęć';
    return 'Publikacja z Facebooka';
  }
  const firstLine = text.split(/\r?\n/).map(line => line.trim()).find(Boolean) || text;
  const sentence = firstLine.match(/^.{1,110}?[.!?](?:\s|$)/u)?.[0]?.trim();
  let title = firstLine.length <= 90 ? firstLine : (sentence || `${firstLine.slice(0, 87).trimEnd()}…`);
  return title.replace(/\s+/g, ' ').trim();
}

function makeExcerpt(text, title, hasImages, attachmentTypes = []) {
  const remaining = text.startsWith(title) ? text.slice(title.length).trim() : text;
  const attachmentFallback = attachmentTypes.includes('video')
    ? 'Materiał wideo opublikowany na Facebooku.'
    : attachmentTypes.includes('link')
      ? 'Link udostępniony na Facebooku.'
      : hasImages
        ? 'Fotorelacja opublikowana na Facebooku.'
        : 'Nowa publikacja na Facebooku.';
  const candidate = remaining || text || attachmentFallback;
  return candidate.length > 210 ? `${candidate.slice(0, 207).trimEnd()}…` : candidate;
}

function normalizePost(post) {
  const text = String(post.message || post.story || '').replace(/\\u0000/g, '').trim();
  const images = collectImages(post);
  const attachments = post.attachments?.data ?? [];
  const attachmentTypes = attachments
    .map(item => String(item.media_type || '').toLowerCase())
    .filter(Boolean);

  if (!text && images.length === 0 && attachments.length === 0) return null;

  const title = makeTitle(text, images.length > 0, attachmentTypes);
  const firstLine = text.split(/\\r?\\n/).map(line => line.trim()).find(Boolean) || '';
  const content = firstLine && firstLine === title
    ? text.slice(text.indexOf(firstLine) + firstLine.length).trim()
    : text;

  return {
    id: String(post.id),
    title,
    excerpt: makeExcerpt(text, title, images.length > 0, attachmentTypes),
    content,
    publishedAt: post.created_time || null,
    permalink: safeHttpsUrl(post.permalink_url),
    image: images[0] || null,
    images,
    source: 'Facebook'
  };
}

function imageExtension(contentType, sourceUrl) {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  const fromType = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif'
  }[type];
  if (fromType) return fromType;

  try {
    const extension = new URL(sourceUrl).pathname.split('.').pop()?.toLowerCase();
    if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'].includes(extension)) {
      return extension === 'jpeg' ? 'jpg' : extension;
    }
  } catch {}
  return 'jpg';
}

async function cacheArticleImages(article, budget) {
  const original = Array.isArray(article.images) && article.images.length
    ? article.images
    : (article.image ? [article.image] : []);
  const unique = [];
  const seen = new Set();

  for (const value of original) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const local = value.startsWith(MEDIA_PREFIX);
    const remote = local ? null : safeHttpsUrl(value);
    if (!local && !remote) continue;
    let key = local ? value : remote;
    if (remote) {
      try {
        const parsed = new URL(remote);
        key = parsed.origin + parsed.pathname;
      } catch {}
    }
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(local ? value : remote);
    if (unique.length >= MAX_IMAGES_PER_ARTICLE) break;
  }

  const cached = [];
  const safeId = String(article.id || 'post').replace(/[^a-z0-9_-]/gi, '-').slice(-80);

  for (let index = 0; index < unique.length; index += 1) {
    const source = unique[index];
    if (source.startsWith(MEDIA_PREFIX)) {
      cached.push(source);
      continue;
    }

    if (budget.remaining <= 0) {
      cached.push(source);
      continue;
    }

    try {
      const response = await fetch(source, {
        headers: { 'User-Agent': 'KajetanPortfolio/1.0' },
        signal: AbortSignal.timeout(20_000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const contentType = response.headers.get('content-type') || '';
      if (contentType && !contentType.toLowerCase().startsWith('image/')) {
        throw new Error('Adres nie zwrócił pliku graficznego');
      }

      const contentLength = Number(response.headers.get('content-length') || 0);
      if (contentLength > MAX_IMAGE_BYTES) throw new Error('Zdjęcie przekracza limit 8 MB');

      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
        throw new Error('Plik zdjęcia jest pusty lub przekracza limit 8 MB');
      }

      const extension = imageExtension(contentType, source);
      const filename = `${safeId}-${index + 1}.${extension}`;
      await writeFile(resolve(MEDIA_DIR, filename), bytes);
      cached.push(`${MEDIA_PREFIX}${filename}`);
      budget.remaining -= 1;
    } catch (error) {
      console.warn(`Nie udało się zapisać zdjęcia posta ${article.id}, zdjęcie ${index + 1}: ${error.message}`);
      cached.push(source);
    }
  }

  return {
    ...article,
    image: cached[0] || null,
    images: cached
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
    const payload = await graphGet(`${encodeURIComponent(PAGE_ID)}/published_posts`, {
      fields: FIELDS,
      limit,
      ...(after ? { after } : {})
    });
    posts.push(...(payload.data || []));
    console.log(`Pobrano łącznie ${posts.length} opublikowanych postów istniejącej strony.`);
    after = payload.paging?.cursors?.after;
    if (!after || !(payload.data || []).length) break;
  }
  return posts;
}

async function readExisting() {
  try {
    const parsed = JSON.parse(await readFile(OUTPUT, 'utf8'));
    return {
      sourceType: parsed.sourceType || null,
      profileId: parsed.profileId || null,
      pageName: parsed.pageName || null,
      generatedAt: parsed.generatedAt || null,
      articles: Array.isArray(parsed.articles) ? parsed.articles : []
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { pageName: null, generatedAt: null, articles: [] };
  }
}


await mkdir(MEDIA_DIR, { recursive: true });

try {
  const pageDetails = await graphGet(encodeURIComponent(PAGE_ID), { fields: 'id,name' });
  const rawPosts = await fetchRecentPosts();
  const newArticles = rawPosts.map(normalizePost).filter(Boolean);
  const existing = await readExisting();

  // Zachowujemy dotychczasowe archiwum. ID posta zapobiega duplikatom.
  const merged = new Map(existing.articles.map(article => [String(article.id), article]));
  for (const article of newArticles) merged.set(article.id, article);

  const sorted = [...merged.values()]
    .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));

  const imageBudget = { remaining: MAX_IMAGE_DOWNLOADS_PER_RUN };
  const articles = [];
  for (const article of sorted) {
    articles.push(await cacheArticleImages(article, imageBudget));
  }

  const output = {
    sourceType: 'facebook_page',
    profileId: null,
    pageId: PAGE_ID,
    pageName: pageDetails.name || existing.pageName || 'Facebook',
    generatedAt: existing.generatedAt,
    articles
  };

  const oldComparable = JSON.stringify({
    pageName: existing.pageName,
    articles: existing.articles
  });
  const newComparable = JSON.stringify({
    pageName: output.pageName,
    articles: output.articles
  });

  if (oldComparable === newComparable) {
    console.log(`Synchronizacja zakończona. Brak zmian; sprawdzono ${rawPosts.length} opublikowanych postów.`);
  } else {
    output.generatedAt = new Date().toISOString();
    await mkdir(dirname(OUTPUT), { recursive: true });
    await writeFile(OUTPUT, `${JSON.stringify(output, null, 2)}\\n`, 'utf8');
    console.log(`Zapisano ${articles.length} artykułów. Nowe lub zaktualizowane posty: ${newArticles.length}. Zapisano lokalnie do ${MAX_IMAGE_DOWNLOADS_PER_RUN - imageBudget.remaining} zdjęć.`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/kod 190|error validating access token|session has expired/i.test(message)) {
    const warning = 'Token strony Meta wygasł lub został unieważniony (kod 190). Nie pobrano nowych postów; zachowano dotychczasowe archiwum.';
    console.log(`::warning title=Token Facebooka wygasł::${warning}`);
    if (process.env.GITHUB_OUTPUT) {
      await appendFile(process.env.GITHUB_OUTPUT, 'status=expired_token\\n');
    }
  } else {
    throw error;
  }
}
