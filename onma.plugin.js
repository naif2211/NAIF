// Harbor source for onma.me (مانجا اون لاين)
const BASE = "https://onma.me";
const PAGE_SIZE = 48;

function clean(text) { return text ? String(text).replace(/\s+/g, " ").trim() : ""; }
function abs(url) {
  if (!url) return undefined;
  url = String(url).trim();
  if (!url || url.startsWith("data:")) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return BASE + url;
  return BASE + "/" + url;
}
async function getDoc(path) {
  const res = await harbor.http(BASE + path, { responseType:"text", timeoutMs:30000, headers:{Referer:BASE+"/"} });
  if (!res.ok) throw new Error("http " + res.status + " for " + path);
  return harbor.parseHtml(res.body || "");
}
function firstText(el, selectors) {
  for (const sel of selectors) { const x=el?.querySelector(sel); const t=clean(x?.text()); if(t) return t; }
  return undefined;
}
function firstAttr(el, selectors, attrs) {
  for (const sel of selectors) { const x=el?.querySelector(sel); if(!x) continue; for(const a of attrs){const v=x.attr(a); if(v) return v;} }
  return undefined;
}
function imageFrom(root) {
  const el=root?.querySelector("img");
  if(!el) return undefined;
  return abs(el.attr("data-src") || el.attr("data-lazy-src") || el.attr("data-original") || el.attr("data-image") || el.attr("src"));
}
function mangaIdFromHref(href) {
  const s=String(href||"").replace(/^https?:\/\/[^/]+/i,"");
  const m=s.match(/^\/manga\/([^/?#]+)\/?(?:[?#].*)?$/i);
  return m ? decodeURIComponent(m[1]) : null;
}
function cardToSummary(el) {
  const link=el.querySelector("a[href^='/manga/']") || el.querySelector("a[href*='/manga/']");
  if(!link) return null;
  const id=mangaIdFromHref(link.attr("href")); if(!id) return null;
  const title=clean(firstText(el,["h2","h3","h4",".post-title",".item-summary .summary-content .post-title",".title",".name"]) || el.querySelector("img")?.attr("alt") || link.attr("aria-label") || link.text());
  if(!title) return null;
  return {id,title,cover:imageFrom(el)};
}
function findCards(doc) {
  const selectors=["div.page-item-detail",".page-item-detail.manga",".manga-item",".item-summary",".row.c-tabs-item__content","article",".manga-list .item",".manga-list li"];
  const out=[],seen=new Set();
  for(const sel of selectors){ for(const el of doc.querySelectorAll(sel)){const item=cardToSummary(el); if(item&&!seen.has(item.id)){seen.add(item.id);out.push(item);}} if(out.length) return out; }
  for(const a of doc.querySelectorAll("a[href^='/manga/'],a[href*='/manga/']")){const id=mangaIdFromHref(a.attr("href")); if(!id||seen.has(id)) continue; const title=clean(a.text()||a.attr("aria-label")||a.attr("title")); if(!title) continue; seen.add(id); out.push({id,title,cover:imageFrom(a.parentElement||a)});}
  return out;
}
function chapterNumber(text,href){const s=clean(text)||String(href||""); let m=s.match(/(?:chapter|ch\.?|الفصل|فصل)\s*#?\s*([0-9]+(?:\.[0-9]+)?)/i); if(!m)m=s.match(/\/([0-9]+(?:\.[0-9]+)?)\/?(?:\?|#|$)/); return m?m[1]:null;}
function chapterFromLink(a){const href=abs(a.attr("href")||"");if(!href)return null;const n=a.attr("data-number")||chapterNumber(a.text(),href);if(!n)return null;return{id:href,chapter:n,title:clean(a.text())||"Chapter "+n,volume:null,pages:0,language:"ar"};}
function chaptersFromDoc(doc){const out=[],seen=new Set();for(const a of doc.querySelectorAll(".chapter-list a[href*='/manga/'],.chapters a[href*='/manga/'],.wp-manga-chapter a,li.wp-manga-chapter a,a[href*='/manga/']")){const c=chapterFromLink(a);if(c&&!seen.has(c.id)){seen.add(c.id);out.push(c);}}return out;}
const plugin={
 id:"onma",name:"مانجا اون لاين",
 async popular(offset){const p=Math.floor(offset/PAGE_SIZE)+1;for(const path of ["/manga/?m_orderby=views&page="+p,"/manga/?orderby=views&page="+p,"/manga/?page="+p]){try{const x=findCards(await getDoc(path));if(x.length)return x;}catch(_){}}return findCards(await getDoc("/"));},
 async search(query,offset){const p=Math.floor(offset/PAGE_SIZE)+1;for(const path of ["/manga/?s="+encodeURIComponent(query)+"&post_type=wp-manga&page="+p,"/?s="+encodeURIComponent(query)+"&page="+p]){try{const x=findCards(await getDoc(path));if(x.length)return x;}catch(_){}}return[];},
 async detail(id){const doc=await getDoc("/manga/"+encodeURIComponent(id));const root=doc.querySelector(".site-content")||doc;return{id,title:clean(root.querySelector("div.post-title h1")?.text())||clean(root.querySelector("h1")?.text())||id,altTitle:firstText(root,[".alternative",".other-name",".post-content_item.manga_alternative .summary-content"]),cover:imageFrom(root.querySelector(".summary_image")||root.querySelector(".profile-manga")||root.querySelector(".tab-summary")||root),author:firstText(root,[".author-content",".post-content_item.manga-authors .summary-content",".post-content_item.manga-author .summary-content"]),status:firstText(root,[".post-content_item.manga-status .summary-content",".status",".manga-status"]),description:firstText(root,[".description-summary",".description",".summary_content",".summary__content"]),lastChapter:firstText(root,[".chapter-list a",".chapters a","li.wp-manga-chapter a"])};},
 async chapters(id){return chaptersFromDoc(await getDoc("/manga/"+encodeURIComponent(id)));},
 async pageUrls(chapterId){const path="/"+String(chapterId).replace(/^https?:\/\/[^/]+/i,"").replace(/^\//,"");const doc=await getDoc(path),urls=[],seen=new Set();for(const sel of [".reading-content img",".chapter-content img",".reader-content img",".page-content img",".entry-content img"]){for(const img of doc.querySelectorAll(sel)){const u=abs(img.attr("data-src")||img.attr("data-lazy-src")||img.attr("data-original")||img.attr("src"));if(u&&!seen.has(u)){seen.add(u);urls.push(u);}}if(urls.length)break;}return urls;},
 async tags(){const doc=await getDoc("/manga/"),out=[],seen=new Set();for(const a of doc.querySelectorAll(".genres-content a,.genres a,.manga-genres a,a[href*='/genre/']")){const name=clean(a.text()),m=(a.attr("href")||"").match(/\/genre\/([^/?#]+)/i);if(name&&m&&!seen.has(m[1])){seen.add(m[1]);out.push({id:decodeURIComponent(m[1]),name,group:"Genre"});}}return out;}
};
return plugin;
