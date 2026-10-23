"""Homebrew builder and effects checks for Character Ledger.
Run from the repo root: python3 tests/homebrew.py
Covers formula effects, level tables, choices, granted resources and spells, effect HP, the Homebrew tab
(feat, item, class with a subclass, species), applying a homebrew class, and exporting and importing a pack."""
import subprocess,time,json,sys,os,tempfile
from playwright.sync_api import sync_playwright
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT=8794
p=subprocess.Popen(['python3','-m','http.server',str(PORT)],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);time.sleep(1)
fails=[];n=[0]
def ok(c,m):
    n[0]+=1
    if not c: fails.append(m); print("FAIL",m)
def run(pg,js,a=None): return pg.evaluate(js,a)
def chars(pg): return json.loads(run(pg,"localStorage.getItem('character-ledger-v1')"))["characters"]
def lib(pg): return json.loads(run(pg,"localStorage.getItem('character-ledger-lib-v1')") or "{}")
def base(**k):
    c={"id":"t1","system":"dnd5e","name":"Tess","level":5,"rules":"2014","abilities":{"str":14,"dex":14,"con":16,"int":10,"wis":12,"cha":8},
       "classes":[{"id":"c1","name":"Barbarian","sub":"","level":5}],"hp":40,"hpMax":40,"ac":12,"speed":30,"features":[],"spells":[],"skills":{},"saveProf":{},"resources":[],"inventory":[]}
    c.update(k);return c
def click(pg,sel): run(pg,"s=>{const b=document.querySelector(s);if(!b)throw new Error('missing '+s);b.click()}",sel);pg.wait_for_timeout(150)
def open_lib(pg):
    """the Library button lives on the Characters screen and the More tabs; press it the same way they do"""
    run(pg,"()=>{const b=document.createElement('button');b.type='button';b.dataset.act='lib-open';document.body.appendChild(b);b.click();b.remove()}");pg.wait_for_timeout(200)
def fill(pg,sel,v): pg.fill(sel,v);pg.wait_for_timeout(60)
def pick(pg,sel,v): pg.select_option(sel,v);pg.wait_for_timeout(120)
def add_effect(pg,path,t,fields):
    click(pg,f'[data-act=hb-fxnew][data-path="{path}"]')
    pick(pg,'[data-hbfe=t]',t)
    for k,v in fields.items():
        el=f'[data-hbfe="{k}"]'
        if run(pg,"s=>document.querySelector(s).tagName",el)=="SELECT": pick(pg,el,v)
        else: fill(pg,el,v)
    click(pg,'[data-act=hb-fxadd]')
    err=run(pg,"(document.querySelector('.hbfxform .msg')||{}).textContent||''")
    ok(not err,f"effect {t} added without error: {err}")
try:
 with sync_playwright() as pw:
  b=pw.chromium.launch();errs=[];CTX=[None]
  def newpage():
    if CTX[0]:CTX[0].close()
    CTX[0]=b.new_context(viewport={'width':412,'height':915},accept_downloads=True);pg=CTX[0].new_page();pg.on('pageerror',lambda e:errs.append(str(e)));return pg
  def load(c,L=None):
    pg=newpage(); pg.goto(f'http://localhost:{PORT}/index.html')
    run(pg,"([s,l])=>{localStorage.clear();localStorage.setItem('character-ledger-v1',JSON.stringify(s));if(l)localStorage.setItem('character-ledger-lib-v1',JSON.stringify(l))}",[{"campaigns":[],"characters":[c] if c else [],"updated":1},L])
    run(pg,"()=>new Promise(r=>{const q=indexedDB.deleteDatabase('ledger-library');q.onsuccess=q.onerror=q.onblocked=()=>r()})")
    pg.reload();pg.wait_for_timeout(700)
    if c: pg.click('.card');pg.wait_for_timeout(500)
    return pg

  # 1) effects engine on an existing character: formulas, level tables, choices, grants, effect HP
  feats=[
    {"id":"f1","name":"Unarmored Test","source":"Barbarian 1","desc":"x","fx":[{"k":"acbase","v":"10+dex+con"}]},
    {"id":"f2","name":"Rage Test","source":"Barbarian 1","desc":"x","fx":[{"k":"pool","n":"Rage","v":{"by":"clevel","t":"1: 2, 3: 3, 6: 4"},"r":"long"}]},
    {"id":"f3","name":"Skill Pick","source":"Barbarian 1","desc":"x","fx":[{"k":"pick","of":"pskill","cnt":2,"opts":["stealth","arcana","nature"],"sel":[]}]},
    {"id":"f4","name":"Magic Test","source":"Barbarian 2","desc":"x","fx":[{"k":"spell","n":"Shield","v":1}]},
    {"id":"f5","name":"Tough Test","source":"Feat","desc":"x","fx":[{"k":"hpl","v":2}]},
    {"id":"f6","name":"Wis Formula","source":"Barbarian 3","desc":"x","fx":[{"k":"abil.wis","v":"floor(clevel/2)"}]},
    {"id":"f7","name":"Raging Test","source":"Barbarian 1","desc":"x","fx":[{"k":"res.fire","v":1,"c":1,"cond":"while raging","on":False}]},
  ]
  pg=load(base(features=feats))
  pg.wait_for_timeout(1200)
  c=chars(pg)[0]
  cap=run(pg,"[...document.querySelectorAll('.fxcap')].map(e=>e.textContent)")
  ok(any("15 with effects" in x for x in cap),f"AC formula 10+dex+con shows 15: {cap}")
  ok(run(pg,"document.querySelector('[data-mod=wis]').textContent")=="+2",f"wis +floor(5/2) gives 14 (+2)")
  rage=[r for r in c["resources"] if r["name"]=="Rage"]
  ok(len(rage)==1 and rage[0]["max"]==3 and rage[0].get("fxk"),f"Rage pool from table at class level 5 = 3: {rage}")
  ok(c["hpMax"]==40 and c.get("fxHp")==10,f"older character keeps max HP, effect HP recorded: {c['hpMax']} {c.get('fxHp')}")
  sp=[s for s in c["spells"] if s["name"]=="Shield"]
  ok(len(sp)==1 and sp[0].get("fxk")=="f4" and sp[0]["level"]==1,f"Shield granted and filled from SRD: {sp}")
  # choose skills on the feature
  sels=run(pg,"[...document.querySelectorAll('select[data-act=fx-pick]')].length")
  ok(sels==2,f"two skill choice menus: {sels}")
  setsel="([s,v])=>{const e=document.querySelector(s);e.value=v;e.dispatchEvent(new Event('change',{bubbles:true}))}"
  run(pg,setsel,['select[data-act=fx-pick][data-p="0"]','stealth']);pg.wait_for_timeout(250)
  opts=run(pg,"[...document.querySelector('select[data-act=fx-pick][data-p=\"1\"]').options].map(o=>o.value+(o.disabled?'!':''))")
  ok(opts==["","stealth!","arcana","nature"],f"only the allowed skills, the one already picked is locked: {opts}")
  run(pg,setsel,['select[data-act=fx-pick][data-p="1"]','arcana']);pg.wait_for_timeout(250)
  c=chars(pg)[0]
  ok([f for f in c["features"] if f["id"]=="f3"][0]["fx"][0]["sel"]==["stealth","arcana"],"choices saved")
  ok(run(pg,"document.querySelector('[data-prof=\"skill.stealth\"]').classList.contains('p1')"),"stealth proficiency from choice")
  # level up the class row by hand to 6: table goes to 4 and Tough adds 2 more
  run(pg,"()=>{const S=JSON.parse(localStorage.getItem('character-ledger-v1'));const c=S.characters[0];c.classes[0].level=6;c.level=6;localStorage.setItem('character-ledger-v1',JSON.stringify(S))}")
  pg.reload();pg.wait_for_timeout(600);pg.click('.card');pg.wait_for_timeout(700)
  c=chars(pg)[0]
  ok([r for r in c["resources"] if r["name"]=="Rage"][0]["max"]==4,"Rage grows to 4 at class level 6")
  ok(c["hpMax"]==42,f"Tough effect adds 2 for the new level: {c['hpMax']}")
  # toggling a conditional effect
  ok(not any(x.get("on",True) for x in [f for f in c["features"] if f["id"]=="f7"][0]["fx"]),"conditional effect starts off")
  # removing the feature removes its resource and spell
  run(pg,"()=>{const S=JSON.parse(localStorage.getItem('character-ledger-v1'));const c=S.characters[0];c.features=c.features.filter(f=>f.id!=='f2'&&f.id!=='f4'&&f.id!=='f5');localStorage.setItem('character-ledger-v1',JSON.stringify(S))}")
  pg.reload();pg.wait_for_timeout(600);pg.click('.card');pg.wait_for_timeout(700)
  c=chars(pg)[0]
  ok(not any(r["name"]=="Rage" for r in c["resources"]) and not any(s["name"]=="Shield" for s in c["spells"]),"resource and spell go when the feature goes")
  ok(c["hpMax"]==30,f"removing Tough takes its HP back off: {c['hpMax']}")

  # 2) Homebrew tab: a feat with three effects, added to a character
  pg=load(base())
  open_lib(pg); click(pg,'[data-act=lib-tab][data-tab=hb]')
  ok(run(pg,"document.querySelectorAll('[data-act=hb-new]').length")==7,"seven kinds of homebrew")
  click(pg,'[data-act=hb-new][data-t=feat]')
  fill(pg,'[data-hb=name]','Lucky Test'); fill(pg,'[data-hb=desc]','You gain luck. Your Wisdom score increases by 1.')
  click(pg,'[data-act=hb-fxauto][data-path=fx]')
  auto=run(pg,"[...document.querySelectorAll('.hbfxrow')].map(e=>e.textContent)")
  ok(any("Wisdom" in x for x in auto),f"Find effects in the text: {auto}")
  add_effect(pg,"fx","hpl",{"val":"2"})
  add_effect(pg,"fx","pool",{"txt":"Luck Points","val":"pb","reset":"short"})
  add_effect(pg,"fx","skillpick",{"cnt":"1"})
  # a bad formula is refused with a message
  click(pg,'[data-act=hb-fxnew][data-path=fx]'); pick(pg,'[data-hbfe=t]','ac'); fill(pg,'[data-hbfe=val]','2+banana'); click(pg,'[data-act=hb-fxadd]')
  ok("banana" in run(pg,"document.querySelector('.hbfxform .msg').textContent"),"bad formula explained")
  click(pg,'[data-act=hb-fxcancel]')
  click(pg,'[data-act=hb-save]')
  L=lib(pg); f=[x for x in L["sections"] if x["name"]=="Lucky Test"]
  ok(f and f[0]["hb"]==1 and f[0]["cat"]=="feat" and len(f[0]["fx"])==4,f"feat saved with effects: {f[0]['fx'] if f else None}")
  click(pg,'[data-act=hb-addchar]'); click(pg,'[data-act=lib-close]'); pg.wait_for_timeout(400)
  c=chars(pg)[0]
  ok(c["abilities"]["wis"]==12 and run(pg,"document.querySelector('[data-mod=wis]').textContent")=="+1",f"feat raises Wisdom to 13 on the sheet")
  ok(c["hpMax"]==50,f"feat adds 2 HP per level at level 5: {c['hpMax']}")
  lp=[r for r in c["resources"] if r["name"]=="Luck Points"]
  ok(lp and lp[0]["max"]==3 and lp[0]["reset"]=="short",f"Luck Points = proficiency bonus, short rest: {lp}")
  ok(run(pg,"document.querySelectorAll('select[data-act=fx-pick]').length")==1,"skill choice menu on the feat")

  # 3) Homebrew item with effects through the gear picker data
  open_lib(pg); click(pg,'[data-act=lib-tab][data-tab=hb]')
  click(pg,'[data-act=hb-new][data-t=item]')
  fill(pg,'[data-hb=name]','Cloak of Testing'); run(pg,"document.querySelector('[data-hb=att]').click()")
  add_effect(pg,"fx","ac",{"val":"1"}); add_effect(pg,"fx","save",{"abAll":"all","val":"1"})
  click(pg,'[data-act=hb-save]')
  click(pg,'[data-act=hb-addchar][data-kind=items]'); click(pg,'[data-act=lib-close]')
  c=chars(pg)[0]; it=[x for x in c["inventory"] if x["name"]=="Cloak of Testing"]
  ok(it and len(it[0].get("fx",[]))==2 and it[0]["att"],f"item carries effects: {it}")

  # 4) Homebrew class with a subclass, then applied to a character
  open_lib(pg); click(pg,'[data-act=lib-tab][data-tab=hb]')
  click(pg,'[data-act=hb-new][data-t=class]')
  fill(pg,'[data-hb=name]','Spellblade Test'); pick(pg,'[data-hb=hd]','10')
  run(pg,"document.querySelector('[data-hbarr=saves][data-v=str]').click();document.querySelector('[data-hbarr=saves][data-v=int]').click()")
  fill(pg,'[data-hb=skN]','2')
  fill(pg,'[data-hb="features.0.name"]','Arcane Armor'); fill(pg,'[data-hb="features.0.desc"]','Your skin hardens with arcane power while you wear no armor.')
  add_effect(pg,"features.0.fx","acbase",{"val":"13+dex"})
  click(pg,'[data-act=hb-addfeat][data-path=features]')
  pick(pg,'[data-hb="features.1.lvl"]','2'); fill(pg,'[data-hb="features.1.name"]','Blade Points'); fill(pg,'[data-hb="features.1.desc"]','You have a pool of blade points.')
  add_effect(pg,"features.1.fx","pool",{"txt":"Blade Points","val":"1: 2, 5: 4","reset":"short"})
  click(pg,'[data-act=hb-asi]')
  ok(run(pg,"[...document.querySelectorAll('.hbcard .sum-t')].filter(e=>e.textContent==='Ability Score Improvement').length")==5,"five ASIs added for 5e")
  click(pg,'[data-act=hb-addsub]')
  fill(pg,'[data-hb="subclasses.0.name"]','Order of Ash')
  fill(pg,'[data-hb="subclasses.0.features.0.name"]','Ash Ward'); fill(pg,'[data-hb="subclasses.0.features.0.desc"]','Ash protects you.')
  add_effect(pg,"subclasses.0.features.0.fx","res",{"dt":"fire"})
  click(pg,'[data-act=hb-save]')
  L=lib(pg); cl=[x for x in L["classes"] if x["name"]=="Spellblade Test"]
  ok(cl and cl[0]["hd"]==10 and cl[0]["saves"]==["str","int"] and len(cl[0]["features"])==7 and cl[0]["subclasses"][0]["features"][0]["fx"][0]["k"]=="res.fire",f"class saved: {cl[0] if cl else None}")
  ok(L["packs"].get("Homebrew",{}).get("creator") is True,"Homebrew source turned on for the creator")
  click(pg,'[data-act=lib-close]')
  # new character with the class, apply features
  pg2=load(base(name="Ash",ac=10,lvlMode="manual",classes=[{"id":"c1","name":"Spellblade Test","sub":"Order of Ash","level":5}],features=[]),L)
  click(pg2,'[data-act=tab][data-tab=details]'); pg2.wait_for_timeout(300)
  click(pg2,'[data-act=cls-apply]'); pg2.wait_for_timeout(1200)
  c=chars(pg2)[0]
  names=[f["name"] for f in c["features"]]
  ok("Arcane Armor" in names and "Blade Points" in names and "Ash Ward" in names,f"class features applied: {names}")
  aa=[f for f in c["features"] if f["name"]=="Arcane Armor"][0]
  ok(aa.get("fx")==[{"k":"acbase","v":"13+dex"}],f"structured effect replaces text guess: {aa.get('fx')}")
  click(pg2,'[data-act=tab][data-tab=sheet]'); pg2.wait_for_timeout(400)
  c=chars(pg2)[0]
  bp=[r for r in c["resources"] if r["name"]=="Blade Points"]
  ok(bp and bp[0]["max"]==4,f"Blade Points 4 at class level 5: {bp}")
  ok(run(pg2,"[...document.querySelectorAll('.fxcap')].some(e=>e.textContent.includes('15 with effects'))"),"AC 13+dex = 15 on the sheet")
  ok(run(pg2,"[...document.querySelectorAll('.fxsum .tag')].some(e=>e.textContent==='Resistance: fire')"),"subclass resistance active")

  # 5) Open an imported entry in the builder, give it an effect, and it is used on the next add
  imp={"updated":9999999999999,"packs":{"Old Book":{"creator":True}},"classes":[],"spells":[],"items":[],
       "sections":[{"id":"s1","name":"Odd Feat","source":"Old Book","cat":"feat","catq":"ok","text":"You become odd. This text sets nothing.","data":{"type":"general"},"fxq":"none"}]}
  pg3=load(base(),imp)
  open_lib(pg3); click(pg3,'[data-act=lib-tab][data-tab=sections]')
  click(pg3,'[data-act=hb-open][data-id=s1]')
  add_effect(pg3,"fx","init",{"val":"pb"})
  click(pg3,'[data-act=hb-save]')
  L3=lib(pg3); s1=[x for x in L3["sections"] if x["id"]=="s1"][0]
  ok(s1["hb"]==1 and s1["fx"]==[{"k":"init","v":"pb"}] and s1["source"]=="Old Book","imported feat updated in place with an effect")

  # 6) species builder and the creator
  click(pg3,'[data-act=hb-new][data-t=species]')
  fill(pg3,'[data-hb=name]','Glimmerkin'); fill(pg3,'[data-hb=speed]','35'); fill(pg3,'[data-hb="ab.dex"]','2')
  fill(pg3,'[data-hb="traits.0.name"]','Glimmer Sight'); fill(pg3,'[data-hb="traits.0.desc"]','You see in the dark.')
  add_effect(pg3,"traits.0.fx","sense",{"sn":"darkvision","val":"90"})
  click(pg3,'[data-act=hb-save]')
  L3=lib(pg3); g=[x for x in L3["sections"] if x["name"]=="Glimmerkin"]
  ok(g and g[0]["cat"]=="species" and g[0]["data"]["speed"]==35 and g[0]["data"]["ab"]=={"dex":2} and g[0]["traits"][0]["fx"][0]["k"]=="sense.darkvision",f"species saved: {g}")

  # 7) export a pack and import it into an empty library
  click(pg3,'[data-act=lib-tab][data-tab=hb]')
  with pg3.expect_download() as dl: click(pg3,'[data-act=hb-export]')
  path=dl.value.path(); pack=json.load(open(path))
  ok(pack.get("ledgerHomebrew")==1 and len(pack["entries"]["sections"])==2,f"pack has the homebrew entries: {[x['name'] for x in pack['entries']['sections']]}")
  L3x=lib(pg3)
  pg4=load(base(),None)
  open_lib(pg4); click(pg4,'[data-act=lib-tab][data-tab=hb]')
  tf=tempfile.NamedTemporaryFile('w',suffix='.json',delete=False); json.dump(pack,tf); tf.close()
  pg4.set_input_files('#hbFile',tf.name); pg4.wait_for_timeout(600)
  ok("Imported 2 new" in run(pg4,"document.querySelector('#hbMsg').textContent"),"pack imported: "+run(pg4,"document.querySelector('#hbMsg').textContent"))
  ok(len(run(pg4,"[...document.querySelectorAll('.prow')]"))==2,"two homebrew rows after import")

  # 8) phone width: nothing wider than the screen in the class editor
  click(pg4,'[data-act=hb-new][data-t=class]'); click(pg4,'[data-act=hb-addsub]')
  wide=run(pg4,"(()=>{const W=document.documentElement.clientWidth;return [...document.querySelectorAll('#libOv *')].filter(e=>e.getBoundingClientRect().right>W+1&&e.offsetParent).map(e=>e.tagName+'.'+e.className).slice(0,5)})()")
  ok(not wide,f"class editor fits a phone screen: {wide}")
  pg4.screenshot(path=os.path.join(tempfile.gettempdir(),"hb-class-editor.png"),full_page=False)

  # 6b) the character creator offers homebrew species and classes and keeps their effects
  L5=L3x; L5["classes"]=[x for x in L["classes"] if x.get("hb")]; L5["packs"]=dict(L5.get("packs",{}),**L.get("packs",{}))
  pg5=load(None,L5)
  run(pg5,"document.querySelector('[data-act=new-char]').click()");pg5.wait_for_timeout(200)
  run(pg5,"document.querySelector('[data-act=new-game][data-v=\"2014\"]').click()");run(pg5,"document.querySelector('[data-act=creator]').click()");pg5.wait_for_timeout(1500)
  for _ in range(12):
    t=run(pg5,"(document.querySelector('#crOv .crbody h3')||{}).textContent||''")
    if os.environ.get("HBDEBUG"):print("step",t,run(pg5,"(document.querySelector('#crOv .msg')||{}).textContent||''"),run(pg5,"[...document.querySelectorAll('#crOv [data-cr]')].map(b=>b.dataset.cr).filter((v,i,a)=>a.indexOf(v)===i).join(',')"))
    if t=="Species":
        sps=run(pg5,"[...document.querySelectorAll('[data-cr=species]')].map(b=>b.dataset.v)")
        ok("Glimmerkin" in sps,f"creator lists the homebrew species: {sps}")
        run(pg5,"document.querySelector('[data-cr=species][data-v=Glimmerkin]').click()");pg5.wait_for_timeout(200)
    if t=="Class":
        cls=run(pg5,"[...document.querySelectorAll('[data-cr=cls]')].map(b=>b.dataset.v)")
        ok("Spellblade Test" in cls,f"creator lists the homebrew class: {cls}")
        run(pg5,"document.querySelector('[data-cr=cls][data-v=\"Spellblade Test\"]').click()");pg5.wait_for_timeout(300)
    if t not in ("Species","Class"): run(pg5,"(()=>{const seen=new Set();for(const b of document.querySelectorAll('#crOv .crbody [data-cr]')){const k=b.dataset.cr;if(seen.has(k)||['rand','back','next','cancel','finish','game','rname'].includes(k))continue;seen.add(k);const grp=[...document.querySelectorAll('#crOv .crbody [data-cr=\"'+k+'\"]')];if(grp.length>=1&&!grp.some(x=>x.classList.contains('on'))&&b.tagName==='BUTTON')b.click()}})()");pg5.wait_for_timeout(150)
    run(pg5,"(()=>{for(const s of document.querySelectorAll('#crOv select')){if(s.value)continue;const o=[...s.options].find(o=>o.value&&!o.disabled);if(o){s.value=o.value;s.dispatchEvent(new Event('change',{bubbles:true}))}}})()")
    if t=="Skills":
        # the generic pass above picked one skill; pick the second
        run(pg5,"(()=>{const g=document.querySelector('#crOv [data-cr=skill]:not(.on):not([disabled])');g&&g.click()})()");pg5.wait_for_timeout(80)
    fin=run(pg5,"(()=>{const f=document.querySelector('[data-cr=finish]');if(f&&!f.disabled){f.click();return 1}const n=document.querySelector('[data-cr=next]');if(n)n.click();return 0})()")
    pg5.wait_for_timeout(500)
    if fin: break
  pg5.wait_for_timeout(1500)
  cc=chars(pg5)
  ok(len(cc)==1,"creator made a character")
  if cc:
    c=cc[0]; fn={f["name"]:f for f in c["features"]}
    ok(c["speed"]==35 and c["race"]=="Glimmerkin",f"species speed and name: {c['speed']} {c['race']}")
    ok("Glimmer Sight" in fn and fn["Glimmer Sight"].get("fx")==[{"k":"sense.darkvision","v":90}],f"trait keeps its effect: {fn.get('Glimmer Sight')}")
    ok(c["classes"][0]["name"]=="Spellblade Test" and c["saveProf"]=={"str":1,"int":1},f"class and saves: {c['classes']} {c['saveProf']}")
    ok("Arcane Armor" in fn and fn["Arcane Armor"].get("fx")==[{"k":"acbase","v":"13+dex"}],"class feature effect from the creator")

  # 9) guided level up with the homebrew class brings in features with their effects
  pg6=load(base(name="Lev",level=1,hp=10,hpMax=10,classes=[{"id":"c1","name":"Spellblade Test","sub":"","level":1}],features=[{"id":"a0","name":"Arcane Armor","source":"Spellblade Test 1","desc":"Your skin hardens with arcane power while you wear no armor.","fx":[{"k":"acbase","v":"13+dex"}]}]),L)
  for lv in (2,3):
    run(pg6,"document.querySelector('[data-act=lvl-start]').click()");pg6.wait_for_timeout(900)
    for _ in range(10):
      st=run(pg6,"(document.querySelector('#lvlOv .crbody h3')||{}).textContent||''")
      if not st: break
      run(pg6,"(()=>{for(const x of document.querySelectorAll('#lvlOv select.chsel')){if(x.value)continue;const o=[...x.options].find(o=>o.value&&!o.disabled);if(o){x.value=o.value;x.dispatchEvent(new Event('change',{bubbles:true}))}}})()");pg6.wait_for_timeout(200)
      if os.environ.get("HBDEBUG"):print("lu",lv,st,run(pg6,"(document.querySelector('#luMsg')||{}).textContent||''"),run(pg6,"[...document.querySelectorAll('#lvlOv [data-lu]')].map(b=>b.dataset.lu).join(',')"))
      done=run(pg6,"(()=>{const b=document.querySelector('#lvlOv [data-lu=ok]')||document.querySelector('#lvlOv [data-lu=next]');b&&b.click();return b&&b.dataset.lu==='ok'})()");pg6.wait_for_timeout(400)
      if done: break
  c=chars(pg6)[0]; fn={f["name"]:f for f in c["features"]}
  ok(c["classes"][0]["level"]==3 and c["classes"][0]["sub"]=="Order of Ash",f"levelled to 3 with the subclass: {c['classes']}")
  ok("Blade Points" in fn and fn["Blade Points"].get("fx",[{}])[0].get("k")=="pool",f"level 2 feature with its effect: {list(fn)}")
  ok("Ash Ward" in fn and fn["Ash Ward"].get("fx")==[{"k":"res.fire","v":1}],"subclass feature with its effect")
  ok(any(r["name"]=="Blade Points" and r["max"]==2 for r in c["resources"]),"Blade Points resource at class level 3")
  print("errors",errs)
  ok(not errs,"page errors "+str(errs))
finally:
  p.kill()
print(n[0],"checks,",len(fails),"failed")
sys.exit(1 if fails else 0)
