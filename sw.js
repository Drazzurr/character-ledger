/* Character Ledger offline helper. Bump VERSION when the app files change. */
const VERSION="ledger-v2";
const SHELL=["./", "index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png", "classes-2014.json", "classes-2024.json", "items-2014.json", "items-2024.json", "magic-2014.json", "magic-2024.json", "spells-2014.json", "spells-2024.json"];
const PF=["pf2e-classes.json","pf2e-origins.json","pf2e-rules.json","pf2e-spells.json","pf2e-feats.json","pf2e-items.json"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(VERSION).then(c=>c.addAll(SHELL).then(()=>Promise.all(PF.map(f=>c.add(f).catch(()=>{}))))).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==VERSION&&k.indexOf("ledger-")===0&&k!=="ledger-ext").map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",e=>{
  const r=e.request; if(r.method!=="GET")return;
  const u=new URL(r.url);
  if(u.origin===location.origin){
    // app files: try the network first so updates arrive, fall back to the saved copy offline
    e.respondWith(fetch(r).then(res=>{if(res.ok){const cp=res.clone();caches.open(VERSION).then(c=>c.put(r,cp))}return res}).catch(()=>caches.match(r,{ignoreSearch:true}).then(m=>m||caches.match("index.html"))));
    return;
  }
  // fonts and the PDF reader: saved after first use so they work offline later
  if(/fonts\.(googleapis|gstatic)\.com|cdnjs\.cloudflare\.com/.test(u.host)){
    e.respondWith(caches.open("ledger-ext").then(c=>c.match(r).then(m=>{
      const net=fetch(r).then(res=>{if(res&&(res.ok||res.type==="opaque"))c.put(r,res.clone());return res}).catch(()=>m);
      return m||net;
    })));
  }
});
