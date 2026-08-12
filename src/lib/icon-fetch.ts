import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CACHE_DIR = process.env.ICON_CACHE_DIR ?? path.join(__dirname, '..', '..', 'icon-cache');
const INDEX_PATH = path.join(CACHE_DIR, 'index.json');

type CacheIndex = Record<string, string | null>;

function ensureCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function loadIndex(): CacheIndex {
  ensureCacheDir();
  if (!fs.existsSync(INDEX_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveIndex(index: CacheIndex): void {
  ensureCacheDir();
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
}

export function cacheKeyFor(name: string, target?: string | null): string {
  return crypto.createHash('sha1').update(target || name).digest('hex');
}

function httpsGetJson(url: string, redirectsLeft = 5): Promise<{ items?: Array<{ type: string; id: number }> }> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'rigdeck' } }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode ?? 0) && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) return reject(new Error('redirect demais'));
          const nextUrl = new URL(res.headers.location, url).toString();
          return resolve(httpsGetJson(nextUrl, redirectsLeft - 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`status ${res.statusCode}`));
        }
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

// Node's https.get NAO segue redirect sozinho (diferente de <img src> no
// navegador, que segue automatico -- por isso os icones Steam do grid ja
// funcionavam client-side mesmo com o CDN redirecionando). Confirmado ao
// vivo: cdn.cloudflare.steamstatic.com devolve 301 pro header.jpg agora.
function httpsDownload(url: string, destPath: string, redirectsLeft = 5): Promise<void> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'rigdeck' } }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode ?? 0) && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) return reject(new Error('redirect demais'));
          const nextUrl = new URL(res.headers.location, url).toString();
          return resolve(httpsDownload(nextUrl, destPath, redirectsLeft - 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`status ${res.statusCode}`));
        }
        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
        file.on('error', reject);
      })
      .on('error', reject);
  });
}

// Busca por nome na Steam Store search API (publica, sem chave) e baixa a
// capa oficial pro cache local -- cobre jogos instalados por outro launcher
// (Epic, GOG, atalho solto) que tambem existem na loja Steam (ex: jogo que
// migrou de Steam pra Epic mantem a pagina antiga). Exclusivos de verdade
// (ex: Fortnite, nunca esteve na Steam) nao acham nada -- cai no
// negative-cache (null) pra nao rebuscar na rede toda vez que o grid carrega.
//
// ponytail: so cobre a Steam Store (unica API keyless conhecida com cobertura
// ampla de jogos). Programa nao-jogo sem presenca na Steam (a maioria dos
// apps de produtividade) continua caindo no monograma -- upgrade seria
// integrar outra fonte (ex: SteamGridDB) se algum dia isso exigir chave de API.
export async function lookupIcon(name: string, target?: string | null): Promise<string | null> {
  if (!name) return null;
  ensureCacheDir();
  const key = cacheKeyFor(name, target);
  const index = loadIndex();
  if (key in index) {
    return index[key] ? path.join(CACHE_DIR, index[key]!) : null;
  }

  try {
    const search = await httpsGetJson(
      `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(name)}&cc=us&l=en`
    );
    // A API devolve type:"app" pra jogo de verdade (nao "game" como seria de
    // se esperar) -- confirmado testando ao vivo contra a API real. Pega o
    // primeiro resultado: a busca da Steam ja ordena por relevancia, e o
    // termo de busca e o nome exato do programa/jogo na maioria dos casos.
    const match = (search.items ?? []).find((it) => it.type === 'app');
    if (!match) {
      index[key] = null;
      saveIndex(index);
      return null;
    }
    const fileName = `${key}.jpg`;
    const destPath = path.join(CACHE_DIR, fileName);
    await httpsDownload(`https://cdn.cloudflare.steamstatic.com/steam/apps/${match.id}/header.jpg`, destPath);
    index[key] = fileName;
    saveIndex(index);
    return destPath;
  } catch {
    // Falha de rede/parse -- NAO cacheia negativo (pode ser passageiro,
    // ex: sem internet no momento), tenta de novo na proxima chamada.
    return null;
  }
}
