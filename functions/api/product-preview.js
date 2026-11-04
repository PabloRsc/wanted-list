const MAX_HTML = 2_000_000;
const TIMEOUT_MS = 10_000;

function validPublicUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("LINK_INVALIDO"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || (url.port && !["80", "443"].includes(url.port))) throw new Error("LINK_INVALIDO");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("DESTINO_NAO_PERMITIDO");
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) throw new Error("DESTINO_NAO_PERMITIDO");
  return url;
}

function decodeEntities(value = "") {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
function attr(tag, name) {
  const match = tag.match(new RegExp(name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i"));
  return decodeEntities(match ? (match[1] ?? match[2] ?? match[3] ?? "") : "");
}
function cleanText(value) { return decodeEntities(String(value || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 300); }
function absoluteImage(value, base) {
  if (!value) return "";
  try { const u = new URL(value, base); return ["https:", "http:"].includes(u.protocol) ? u.href : ""; } catch { return ""; }
}
function meta(html, key) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const k = attr(tag, "property") || attr(tag, "name") || attr(tag, "itemprop");
    if (k.toLowerCase() === key.toLowerCase()) return attr(tag, "content");
  }
  return "";
}
function productFromJson(value) {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) { for (const v of value) { const found = productFromJson(v); if (found) return found; } return null; }
  const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
  if (types.some(t => String(t).toLowerCase() === "product")) return value;
  for (const key of ["@graph", "mainEntity", "mainEntityOfPage", "itemListElement"]) {
    const found = productFromJson(value[key]); if (found) return found;
  }
  return null;
}
function structuredProduct(html) {
  const scripts = html.match(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const script of scripts) {
    const raw = script.replace(/^<[\s\S]*?>|<\/script>$/gi, "");
    try { const p = productFromJson(JSON.parse(raw)); if (p) return p; } catch {}
  }
  return null;
}
function parsePrice(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : "";
  let raw = String(value).trim().replace(/[^0-9,.-]/g, "");
  if (!raw) return "";
  const comma = raw.lastIndexOf(","), dot = raw.lastIndexOf(".");
  if (comma > dot) raw = raw.replace(/\./g, "").replace(",", ".");
  else if (dot > comma && comma >= 0) raw = raw.replace(/,/g, "");
  else if (comma >= 0) raw = raw.replace(",", ".");
  const number = Number(raw);
  return Number.isFinite(number) && number >= 0 ? number : "";
}
function priceFromProduct(product) {
  if (!product) return "";
  let offers = product.offers;
  if (Array.isArray(offers)) offers = offers[0];
  if (offers && offers.offers) offers = Array.isArray(offers.offers) ? offers.offers[0] : offers.offers;
  const price = offers?.price ?? offers?.lowPrice ?? product.price;
  return parsePrice(price);
}
function amazonImage(html, base) {
  const tags = html.match(/<img\b[^>]*>/gi) || [];
  for (const tag of tags) {
    if (!/(?:id\s*=\s*["']landingImage["']|data-a-image-name\s*=\s*["']landingImage["'])/i.test(tag)) continue;
    for (const key of ["data-old-hires", "src"]) {
      const value = attr(tag, key);
      if (value && !value.startsWith("data:image")) return absoluteImage(value, base);
    }
    const dynamic = attr(tag, "data-a-dynamic-image");
    if (dynamic) {
      try { const images = JSON.parse(dynamic.replace(/&quot;/g, '"')); const first = Object.keys(images).sort((a,b)=>(images[b]?.[0]||0)-(images[a]?.[0]||0))[0]; if (first) return absoluteImage(first, base); } catch {}
    }
  }
  return "";
}
function amazonPrice(html) {
  const selectors = [
    /<span[^>]*class=["'][^"']*a-price[^"']*["'][^>]*>[\s\S]*?<span[^>]*class=["'][^"']*a-offscreen[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
    /["']priceToPay["'][\s\S]{0,500}?["']value["']\s*:\s*["']?([\d.,]+)/i,
    /["']apexPriceToPay["'][\s\S]{0,500}?["']value["']\s*:\s*["']?([\d.,]+)/i
  ];
  for (const re of selectors) {
    const m = html.match(re);
    if (!m) continue;
    const raw = cleanText(m[1]).replace(/[^\d,.-]/g, "");
    if (!raw) continue;
    const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
    const n = Number(normalized);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return "";
}
function storeName(url, html) {
  const site = meta(html, "og:site_name");
  if (site) return cleanText(site);
  return url.hostname.replace(/^www\./, "");
}

export async function onRequestPost({ request }) {
  const cors = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: cors });
  try {
    const body = await request.json();
    const input = String(body?.url || "").trim();
    if (!input || input.length > 2048) return reply(400, { error: "Informe um link válido." });
    let target = validPublicUrl(input);
    let response, html;
    for (let attempt = 0; attempt < 4; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        response = await fetch(target.href, { headers: { "user-agent": "Mozilla/5.0 (compatible; WantedListProductImporter/1.0)", "accept": "text/html,application/xhtml+xml" }, redirect: "manual", signal: controller.signal });
      } finally { clearTimeout(timer); }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location || attempt === 3) return reply(422, { error: "A loja redirecionou muitas vezes. Abra o anúncio e tente novamente." });
        target = validPublicUrl(new URL(location, target).href);
        continue;
      }
      break;
    }
    if (!response?.ok) return reply(422, { error: "Não foi possível acessar esse anúncio. A loja pode bloquear consultas automáticas." });
    const type = response.headers.get("content-type") || "";
    if (!type.includes("text/html") && !type.includes("application/xhtml")) return reply(422, { error: "O link não parece ser uma página de produto." });
    const reader = response.body?.getReader();
    if (!reader) return reply(422, { error: "A loja não retornou o conteúdo do anúncio." });
    const chunks = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_HTML) { await reader.cancel(); return reply(413, { error: "A página do anúncio é muito grande para analisar." }); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    html = new TextDecoder().decode(bytes);
    const product = structuredProduct(html);
    let title = cleanText(product?.name) || cleanText(meta(html, "og:title")) || cleanText(meta(html, "twitter:title"));
    if (!title) { const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i); title = cleanText(match?.[1]); }
    let imageValue = product?.image;
    if (Array.isArray(imageValue)) imageValue = imageValue[0]?.url || imageValue[0];
    if (imageValue && typeof imageValue === "object") imageValue = imageValue.url || imageValue.contentUrl;
    const image = absoluteImage(imageValue, target) || absoluteImage(meta(html, "og:image"), target) || absoluteImage(meta(html, "twitter:image"), target) || (/(^|\.)amazon\./i.test(target.hostname) ? amazonImage(html, target) : "");
    const price = priceFromProduct(product) || meta(html, "product:price:amount") || meta(html, "og:price:amount") || (/(^|\.)amazon\./i.test(target.hostname) ? amazonPrice(html) : "");
    const numericPrice = parsePrice(price);
    return reply(200, { title, image, price: numericPrice, currency: product?.offers?.priceCurrency || meta(html, "product:price:currency") || meta(html, "og:price:currency") || "", store: storeName(target, html), url: target.href, found: Boolean(title || image || price) });
  } catch (error) {
    if (error?.name === "AbortError") return reply(504, { error: "A loja demorou demais para responder. Tente novamente." });
    const message = String(error?.message || "");
    if (["LINK_INVALIDO", "DESTINO_NAO_PERMITIDO"].includes(message)) return reply(400, { error: "Esse endereço não é permitido. Informe um link público de produto." });
    return reply(500, { error: "Não foi possível analisar o anúncio neste momento." });
  }
}
