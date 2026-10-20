/* Character Ledger offline helper. Bump VERSION when the app files change. */
const VERSION="ledger-v20";
/* Third-party files in vendor/ never change for a given version, so they get their own cache that survives app updates. */
const VENDOR="ledger-vendor-pdfjs-6.4.299";
const SHELL=["./", "index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png", "classes-2014.json", "classes-2024.json", "items-2014.json", "items-2024.json", "magic-2014.json", "magic-2024.json", "spells-2014.json", "spells-2024.json"];
const PF=["pf2e-classes.json","pf2e-origins.json","pf2e-rules.json","pf2e-spells.json","pf2e-feats.json","pf2e-items.json"];
const IMP=["importer/importer.js","importer/core.js","importer/db.js","importer/extract.js","importer/vocab.js","importer/worker.js","importer/layout.js","importer/styles.js"];
const VENDOR_FILES=["vendor/pdfjs/pdf.mjs","vendor/pdfjs/pdf.worker.mjs"];
self.addEventListener("install",e=>{e.waitUntil(
  caches.open(VERSION).then(c=>c.addAll(SHELL).then(()=>Promise.all(PF.concat(IMP).map(f=>c.add(f).catch(()=>{})))))
  .then(()=>caches.open(VENDOR)).then(v=>Promise.all(VENDOR_FILES.map(f=>v.match(f).then(m=>m||v.add(f)).catch(()=>{}))))
  .then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==VERSION&&k!==VENDOR&&k.indexOf("ledger-")===0&&k!=="ledger-ext").map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",e=>{
  const r=e.request; if(r.method!=="GET")return;
  const u=new URL(r.url);
  if(u.origin===location.origin){
    if(u.pathname.indexOf("/vendor/")>=0){
      // pdf.js and its fonts and maps: saved copy first, network the first time
      e.respondWith(caches.open(VENDOR).then(c=>c.match(r,{ignoreSearch:true}).then(m=>m||fetch(r).then(res=>{if(res.ok)c.put(r,res.clone());return res}))));
      return;
    }
    // app files: try the network first so updates arrive, fall back to the saved copy offline
    e.respondWith(fetch(r).then(res=>{if(res.ok){const cp=res.clone();caches.open(VERSION).then(c=>c.put(r,cp))}return res}).catch(()=>caches.match(r,{ignoreSearch:true}).then(m=>m||(r.mode==="navigate"?caches.match("index.html"):Response.error()))));
    return;
  }
  // fonts and the old CDN PDF reader: saved after first use so they work offline later
  if(/fonts\.(googleapis|gstatic)\.com|cdnjs\.cloudflare\.com/.test(u.host)){
    e.respondWith(caches.open("ledger-ext").then(c=>c.match(r).then(m=>{
      const net=fetch(r).then(res=>{if(res&&(res.ok||res.type==="opaque"))c.put(r,res.clone());return res}).catch(()=>m);
      return m||net;
    })));
  }
});
