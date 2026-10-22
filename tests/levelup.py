"""Level-up checks for Character Ledger: guided level up for SRD and Library classes, multiclassing, undo,
random characters above level 1 and feature kinds for imported content. Run from the repo root: python3 tests/levelup.py"""
import subprocess,time,json,sys
from playwright.sync_api import sync_playwright
import os
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
p=subprocess.Popen(['python3','-m','http.server','8792'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);time.sleep(1)
fails=[]
def ok(c,m):
    if not c: fails.append(m); print("FAIL",m)
TABLE="\n".join(["Level | Proficiency Bonus | Features | Cantrips Known | Spells Known | 1st | 2nd | 3rd"]+[f"{l}{'st' if l==1 else 'nd' if l==2 else 'rd' if l==3 else 'th'} | +{(l-1)//4+2} | x | {2+(l>=4)} | {l+1} | {min(4,l+1)} | {3 if l>=3 else 0} | {2 if l>=5 else 0}" for l in range(1,21)])
LIB={"updated":9999999999999,"packs":{"Valda Test":{"creator":True}},
 "classes":[{"id":"vc1","name":"Binder","source":"Valda Test","hd":8,"caster":"custom","ability":"cha","saves":["wis","cha"],
   "slots":{str(l):[min(4,l+1),3 if l>=3 else 0,2 if l>=5 else 0] for l in range(1,21)},
   "tableText":TABLE,
   "features":[{"lvl":1,"name":"Class Traits","desc":"Hit Dice: 1d8 per binder level\nArmor: Light armor\nWeapons: Simple weapons\nSkills: Choose two from Arcana, Deception, History, Insight, and Religion\nEquipment\nYou start with the following equipment:\n(a) a dagger or (b) a quarterstaff\nLeather armor and a component pouch"},
     {"lvl":1,"name":"Spellcasting","desc":"Charisma is your spellcasting ability."},
     {"lvl":1,"name":"Soul Binding","desc":"You bind spirits."},
     {"lvl":2,"name":"Seal Rite","desc":"You learn a binding rite. Choose one of the following rites.\n\nBonded Flame\nFire seal.\n\nBonded Frost\nPrerequisite: 5th level\nCold seal.\n\nBonded Storm\nStorm seal."},
     {"lvl":3,"name":"Binder Pact","desc":"Choose a pact subclass."},
     {"lvl":3,"name":"Fighting Style","desc":"At 3rd level, you adopt a style of fighting as your specialty. Choose one of the following options. You can't take a Fighting Style option more than once."},
     {"lvl":3,"name":"Spirit Lore","desc":"You gain proficiency in one skill of your choice from Arcana, History, or Religion."},
     {"lvl":4,"name":"Ability Score Improvement","desc":"Increase scores."},
     {"lvl":5,"name":"Greater Binding","desc":"More binding."}],
   "subclasses":[{"name":"Pact of Ash","features":[{"lvl":3,"name":"Ash Form","desc":"Ashy."},{"lvl":5,"name":"Ash Storm","desc":"Ash storm."}]},
                 {"name":"Pact of Tide","features":[{"lvl":3,"name":"Tide Form","desc":"Wet."}]}]}],
 "spells":[{"id":"vs1","name":"Spirit Bolt","level":0,"school":"Evocation","classes":["Binder"],"desc":"Bolt.","source":"Valda Test"},
           {"id":"vs2","name":"Ghost Chain","level":1,"school":"Conjuration","classes":[],"desc":"Chain.","source":"Valda Test"},
           {"id":"vs3","name":"Wraith Ward","level":1,"school":"Abjuration","classes":["Binder"],"desc":"Ward.","source":"Valda Test"},
           {"id":"vs4","name":"Soul Lance","level":2,"school":"Necromancy","classes":["Binder"],"desc":"Lance.","source":"Valda Test"}],
 "items":[],
 "sections":[{"id":"vf1","name":"Spirit Touched","source":"Valda Test","kind":"feat","text":"Feat\nPrerequisite: none\nIncrease your Wisdom or Charisma score by 1, to a maximum of 20. You can see spirits."},
   {"id":"vsl1","name":"Binder Spells","source":"Valda Test","kind":"text","text":"Binder Spells\nCantrips (0 Level): Spirit Bolt, Fire Bolt\n1st Level: Ghost Chain, Shield, Wraith Ward"},
   {"id":"vsp1","name":"Veilkin","source":"Valda Test","kind":"species","text":"Veilkin Traits\nAbility Score Increase. Your Charisma score increases by 2.\nAge. They live long.\nSize. Veilkin are Medium.\nSpeed. Your base walking speed is 30 feet.\nDarkvision. You can see in dim light within 60 feet of you as if it were bright light.\nVeil Step. Once per long rest you can teleport 10 feet.\nLanguages. You can speak, read, and write Common and Sylvan.\nSubraces\nDusk Veilkin\nAbility Score Increase. Your Wisdom score increases by 1.\nDusk Sight. Your darkvision extends to 120 feet.\nDawn Veilkin\nAbility Score Increase. Your Strength score increases by 1.\nDawn Blade. You are proficient with longswords."}]}
def run(pg,js,a=None): return pg.evaluate(js,a)
FILLJS="""(()=>{for(const s of document.querySelectorAll('#lvlOv select.chsel, #crOv select.chsel')){if(s.value)continue;const o=[...s.options].find(o=>o.value&&!o.disabled);if(o){s.value=o.value;s.dispatchEvent(new Event('change',{bubbles:true}));return 1}}for(const i of document.querySelectorAll('#lvlOv input[data-chf], #crOv input[data-chf]')){if(!i.value){i.value='x';i.dispatchEvent(new Event('input',{bubbles:true}))}}return 0})()"""
def fill(pg):
    for i in range(30):
        pg.wait_for_timeout(200)
        if not pg.evaluate(FILLJS): pg.wait_for_timeout(300)
        if not pg.evaluate(FILLJS): return
def step_through(pg,maxsteps=12,pick=0):
    """Walk the level-up wizard choosing sensible options."""
    for _ in range(maxsteps):
        pg.wait_for_timeout(250)
        st=run(pg,"(document.querySelector('#lvlOv .crbody h3')||{}).textContent||''")
        if not st: return "closed"
        if st=="Class":
            run(pg,"(()=>{if(!document.querySelector('#lvlOv [data-lu=cls].on,#lvlOv [data-lu=ncls].on'))document.querySelector('#lvlOv [data-lu=cls]').click()})()")
        if st=="Subclass":
            run(pg,f"document.querySelectorAll('#lvlOv [data-lu=sub]')[{pick}].click()")
        if st in ("Features","Improvement"): fill(pg)
        if st=="Improvement":
            sel=run(pg,"(()=>{const s=document.querySelector('#lvlOv select[data-luf=a]');if(s&&!s.value){s.value=s.options[1].value;s.dispatchEvent(new Event('change',{bubbles:true}))}return !!s})()")
        if st=="Spells":
            run(pg,"document.querySelector('#lvlOv [data-lu=spauto]').click()")
        pg.wait_for_timeout(200)
        btn=run(pg,"(()=>{const b=document.querySelector('#lvlOv [data-lu=ok]')||document.querySelector('#lvlOv [data-lu=next]');const t=b.dataset.lu;b.click();return t})()")
        pg.wait_for_timeout(300)
        msg=run(pg,"(document.querySelector('#luMsg')||{}).textContent||''")
        if msg: return "msg:"+st+":"+msg
        if btn=="ok": return "done"
    return "stuck"
def cr_to(pg,name,species=None):
    for _ in range(10):
        t=pg.evaluate("document.querySelector('#crOv .crbody h3').textContent")
        if t==name:return True
        if t=="Species":
            pg.evaluate("(v)=>{const b=[...document.querySelectorAll('[data-cr=species]')].find(b=>!v||b.dataset.v===v);b.click()}",species);pg.wait_for_timeout(200)
            for k in range(2): pg.evaluate("(()=>{const b=document.querySelector('[data-cr=abo]:not(.on)');b&&b.click()})()");pg.wait_for_timeout(150)
        pg.evaluate("document.querySelector('[data-cr=next]').click()");pg.wait_for_timeout(250)
    return False
def chars(pg): return json.loads(run(pg,"localStorage.getItem('character-ledger-v1')"))["characters"]
def load(pg,c,lib=None):
    pg=newpage()
    pg.goto('http://localhost:8792/index.html')
    run(pg,"([s,l])=>{localStorage.clear();localStorage.setItem('character-ledger-v1',JSON.stringify(s));if(l)localStorage.setItem('character-ledger-lib-v1',JSON.stringify(l))}",[{"campaigns":[],"characters":[c] if c else [],"updated":1},lib])
    # clear IndexedDB library so the localStorage copy wins
    run(pg,"()=>new Promise(r=>{const q=indexedDB.deleteDatabase('ledger-library');q.onsuccess=q.onerror=q.onblocked=()=>r()})")
    pg.reload();pg.wait_for_timeout(700)
    if c: pg.click('.card');pg.wait_for_timeout(300)
    return pg
def base(**k):
    c={"id":"t1","system":"dnd5e","name":"T","level":1,"rules":"2014","abilities":{"str":14,"dex":14,"con":14,"int":12,"wis":12,"cha":16},"classes":[{"id":"c1","name":"Fighter","sub":"","level":1}],"hp":12,"hpMax":12,"ac":10,"speed":30,"features":[],"spells":[],"skills":{"athletics":1,"perception":1}}
    c.update(k);return c
try:
 with sync_playwright() as pw:
  b=pw.chromium.launch();errs=[];CTX=[None]
  def newpage():
    if CTX[0]:CTX[0].close()
    CTX[0]=b.new_context(viewport={'width':412,'height':915});pg=CTX[0].new_page();pg.on('pageerror',lambda e:errs.append(str(e)));return pg
  pg=None
  # 1) SRD classes 1 -> 6 via guided steps
  for rules,cls in [("2014","Warlock")]+([] if len(sys.argv)>1 else [("2014","Fighter"),("2014","Sorcerer"),("2024","Wizard"),("2024","Fighter"),("2014","Rogue"),("2024","Cleric"),("2014","Monk")]):
    pg=load(pg,base(rules=rules,classes=[{"id":"c1","name":cls,"sub":"","level":1}]))
    for lv in range(2,7):
        run(pg,"document.querySelector('[data-act=lvl-start]').click()");pg.wait_for_timeout(700)
        r=step_through(pg)
        ok(r=="done",f"{rules} {cls} ->{lv}: {r}")
        if r!="done": run(pg,"document.querySelector('#lvlOv [data-lu=cancel]')&&document.querySelector('#lvlOv [data-lu=cancel]').click()");break
    c=chars(pg)[0]
    ok(c["classes"][0]["level"]==6,f"{rules} {cls} level {c['classes'][0]['level']}")
    print(rules,cls,"L",c["level"],"sub",c["classes"][0]["sub"],"hp",c["hpMax"],"abil",c["abilities"],"feats",len(c["features"]),"spells",len(c["spells"]))
    print("   ",[f["name"] for f in c["features"]])
  # 2) Library class Binder 1 -> 5, plus feat list and spells from Library
  pg=load(pg,base(classes=[{"id":"c1","name":"Binder","sub":"","level":1}]),LIB)
  seen=[]
  for lv in range(2,6):
    run(pg,"document.querySelector('[data-act=lvl-start]').click()");pg.wait_for_timeout(700)
    # record step names
    seen.append(run(pg,"[...document.querySelectorAll('#lvlOv .crprog span')].map(s=>s.textContent).join(',')"))
    if lv==2:
        for _ in range(6):
            st=run(pg,"document.querySelector('#lvlOv .crbody h3').textContent")
            if st=="Features":break
            if st=="Spells": run(pg,"document.querySelector('#lvlOv [data-lu=spauto]').click()")
            run(pg,"(()=>{const b=document.querySelector('#lvlOv [data-lu=next]');b&&b.click()})()");pg.wait_for_timeout(250)
        pg.wait_for_timeout(400)
        cards=run(pg,"[...document.querySelectorAll('#lvlOv select[data-lug] option')].filter(o=>o.value).map(o=>o.textContent+(o.disabled?' [locked]':''))")
        print("seal cards",cards)
        ok(len(cards)==3 and any('locked' in x and 'Frost' in x for x in cards),"split options with locked prerequisite")
    if lv==4:
        # go to Improvement and choose the library feat
        for _ in range(6):
            st=run(pg,"document.querySelector('#lvlOv .crbody h3').textContent")
            if st=="Improvement":break
            run(pg,"(()=>{const b=document.querySelector('#lvlOv [data-lu=next]');b&&b.click()})()");pg.wait_for_timeout(250)
        run(pg,"document.querySelector('#lvlOv [data-lu=asik][data-v=feat]').click()");pg.wait_for_timeout(200)
        opts=run(pg,"[...document.querySelectorAll('#lvlOv select[data-luf=f] option')].map(o=>o.value)")
        ok("Spirit Touched" in opts,f"library feat offered {opts[:5]}")
        run(pg,"(()=>{const s=document.querySelector('#lvlOv select[data-luf=f]');s.value='Spirit Touched';s.dispatchEvent(new Event('change',{bubbles:true}))})()");pg.wait_for_timeout(200)
        pg.wait_for_timeout(300)
        fa=run(pg,"[...document.querySelectorAll('#lvlOv select[data-chs] option')].filter(o=>o.value).map(o=>o.value)")
        ok(fa==["wis","cha"],f"feat ability choice {fa}")
        run(pg,"(()=>{const s=document.querySelector('#lvlOv select[data-chs]');s.value='cha';s.dispatchEvent(new Event('change',{bubbles:true}))})()");pg.wait_for_timeout(200)
    r=step_through(pg); ok(r=="done",f"Binder ->{lv}: {r}")
  print("binder steps",seen)
  c=chars(pg)[0]
  print("binder",c["classes"],c["abilities"]["cha"],[ (f["name"],f["source"],f.get("type")) for f in c["features"]],[s["name"] for s in c["spells"]])
  ok(c["classes"][0]["level"]==5 and c["classes"][0]["sub"],"binder level/sub")
  sr=[f for f in c["features"] if f["name"]=="Seal Rite"]
  ok(not any(f["name"].startswith("Seal Rite:") for f in c["features"]),"picked option is not a separate feature")
  ok(sr and len(sr[0].get("opts",[]))==1,"binder one seal rite attached to Seal Rite")
  ok(not any(o["name"]=="Bonded Frost" for f in sr for o in f.get("opts",[])),"prerequisite respected")
  ok(any(s["name"] in ("Fire Bolt","Shield","Ghost Chain") for s in c["spells"]),"spell list section linked (SRD and unlinked spells)")
  ok(not any(s["name"]=="Magic Missile" for s in c["spells"]),"only listed spells offered")
  ok(any(f["name"]=="Fighting Style" and f.get("opts") for f in c["features"]),"fighting style with no options listed got a pick, attached to the feature")
  ok(any(c["skills"].get(k)==1 for k in ("arcana","history","religion")),"skill choice applied")
  ok(any(f.get("chosen") for f in c["features"] if f["name"]=="Spirit Lore"),"choice saved on the feature")
  ok(c["abilities"]["cha"]==17,"feat raised cha")
  ok(any(s["name"]=="Soul Lance" or s["name"]=="Ghost Chain" for s in c["spells"]),"library spells picked")
  icons=run(pg,"[...document.querySelectorAll('#featBox details.item>summary')].map(s=>s.querySelector('.sum-t').textContent+'='+s.title)")
  print(icons)
  ok(all("General" not in i for i in icons),"no general icons for library class features")
  # undo
  run(pg,"document.querySelector('[data-act=lvl-undo]').click()");pg.wait_for_timeout(400)
  ok(chars(pg)[0]["classes"][0]["level"]==4,"undo")
  # 3) multiclass
  pg=load(pg,base(classes=[{"id":"c1","name":"Fighter","sub":"","level":3}],abilities={"str":14,"dex":14,"con":14,"int":12,"wis":13,"cha":16}))
  run(pg,"document.querySelector('[data-act=lvl-start]').click()");pg.wait_for_timeout(700)
  run(pg,"document.querySelector('#lvlOv details.item summary').click()");pg.wait_for_timeout(100)
  run(pg,"[...document.querySelectorAll('#lvlOv [data-lu=ncls]')].find(b=>b.dataset.v==='Warlock').click()");pg.wait_for_timeout(800)
  r=step_through(pg); ok(r=="done","multiclass: "+r)
  c=chars(pg)[0]; print("multi",c["classes"],c["level"],[s["name"] for s in c["spells"]],c["spellcasting"]["pact"])
  ok(len(c["classes"])==2 and c["level"]==4,"multiclass rows")
  # 4) random character to level 5 with library content on, and icons
  pg=load(pg,None,LIB)
  run(pg,"document.querySelector('[data-act=new-char]').click()");pg.wait_for_timeout(200)
  run(pg,"document.querySelector('[data-act=new-game][data-v=\"2014\"]').click()");pg.wait_for_timeout(200)
  run(pg,"document.querySelector('[data-act=creator-rand]').click()");pg.wait_for_timeout(2500)
  run(pg,"document.querySelector('[data-cr=back]').click()");pg.wait_for_timeout(100)
  for _ in range(10):
    t=run(pg,"document.querySelector('#crOv .crbody h3').textContent")
    if t=="Basics":break
    run(pg,"document.querySelector('[data-cr=back]').click()");pg.wait_for_timeout(100)
  run(pg,"(()=>{const i=document.querySelector('[data-crf=level]');i.value='5';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}))})()");pg.wait_for_timeout(300)
  for _ in range(12):
    t=run(pg,"(document.querySelector('[data-cr=finish]')||{}).dataset")
    if t: break
    run(pg,"document.querySelector('[data-cr=next]').click()");pg.wait_for_timeout(200)
    m=run(pg,"document.querySelector('#crOv .msg').textContent")
    if m: print("creator msg",m);break
  run(pg,"document.querySelector('[data-cr=finish]').click()");pg.wait_for_timeout(4000)
  c=chars(pg)[-1]; print("random",c["race"],c["classes"],c["level"],c["hpMax"],[f["name"]+"|"+f["source"] for f in c["features"]])
  print(run(pg,"[...document.querySelectorAll('#featBox details.item>summary')].map(s=>s.querySelector('.sum-t').textContent+'='+s.title)"))
  ok(c["level"]==5,"random auto-levelled to 5 (got %s)"%c["level"])

  # 5) Pathfinder: random level 1 character, then guided level ups to 5
  for want in ("Sorcerer","Fighter"):
    pg=load(pg,None)
    run(pg,"document.querySelector('[data-act=new-char]').click()");pg.wait_for_timeout(200)
    run(pg,"document.querySelector('[data-act=new-game][data-v=pf2e]').click()");pg.wait_for_timeout(200)
    run(pg,"document.querySelector('[data-act=creator]').click()");pg.wait_for_timeout(3000)
    # pick class directly in the creator state via the random button, then force the class
    run(pg,"document.querySelector('[data-cr=rand]').click()");pg.wait_for_timeout(1500)
    run(pg,"document.querySelector('[data-cr=finish]').click()");pg.wait_for_timeout(2500)
    S=json.loads(run(pg,"localStorage.getItem('character-ledger-v1')"));c=S["characters"][-1]
    c["cls"]=want;c["pf"]["classHp"]=6 if want=="Sorcerer" else 10
    if want=="Sorcerer": c["pf"]["cast"]=dict(c["pf"].get("cast",{}),kind="spontaneous",trad="arcane",abl="cha")
    pg=load(pg,c)
    for lv in range(2,6):
      run(pg,"document.querySelector('[data-act=lvl-start]').click()");pg.wait_for_timeout(1500)
      for _ in range(10):
        st=run(pg,"(document.querySelector('#lvlOv .crbody h3')||{}).textContent||''")
        if not st:break
        if st=="Skill increase": run(pg,"document.querySelector('#lvlOv [data-plu=ski]:not([disabled])').click()")
        if st=="Attribute boosts":
          for i in range(4): run(pg,"document.querySelector('#lvlOv [data-plu=boost]:not(.on)').click()");pg.wait_for_timeout(120)
        if st=="Feats":
          for i in range(3):
            run(pg,"(()=>{const hs=[...document.querySelectorAll('#lvlOv .crbody h4')];for(const h of hs){if(!h.textContent.includes(':')){let g=h.nextElementSibling;while(g&&!g.classList.contains('crgrid'))g=g.nextElementSibling;const b=g&&g.querySelector('.crc');if(b){b.click();return}}}})()");pg.wait_for_timeout(250)
        if st=="Spells":
          for i in range(3): run(pg,"(()=>{const b=document.querySelector('#lvlOv [data-plu=sp]:not(.on)');b&&b.click()})()");pg.wait_for_timeout(120)
        pg.wait_for_timeout(250)
        t=run(pg,"(()=>{const b=document.querySelector('#lvlOv [data-plu=ok]')||document.querySelector('#lvlOv [data-plu=next]');b.click();return b.dataset.plu})()");pg.wait_for_timeout(400)
        m=run(pg,"(document.querySelector('#lvlOv .msg.err')||{}).textContent||''")
        if m: print("pf msg",st,m);break
        if t=="ok":break
    c=chars(pg)[0]
    print("pf",want,c["level"],c["hpMax"],c["pf"]["mods"],[ (f["name"],f["cat"],f.get("at")) for f in c["pf"]["feats"] if f["cat"]!="classfeature"],len(c["pf"]["spells"]),c["pf"].get("cast",{}).get("slots",{}).get("2"))
    ok(c["level"]==5,f"pf {want} reached 5")
    ok(sum(1 for f in c["pf"]["feats"] if f["cat"] in ("class","skill","general","ancestry") and (f.get("at") or 0)>=2)>=5,f"pf {want} feats chosen")
    ok(len(c.get("lvlHist",[]))>=1,"pf undo history")

  # 6) books per campaign and choices on the sheet
  camp={"id":"k1","name":"Strahd","srcs":{}}
  pg=newpage();pg.goto('http://localhost:8792/index.html')
  run(pg,"([s,l])=>{localStorage.clear();localStorage.setItem('character-ledger-v1',JSON.stringify(s));localStorage.setItem('character-ledger-lib-v1',JSON.stringify(l))}",[{"campaigns":[camp],"characters":[],"updated":1},LIB])
  run(pg,"()=>new Promise(r=>{const q=indexedDB.deleteDatabase('ledger-library');q.onsuccess=q.onerror=q.onblocked=()=>r()})");pg.reload();pg.wait_for_timeout(700)
  run(pg,"document.querySelector('[data-act=filter][data-camp=k1]').click()");pg.wait_for_timeout(200)
  run(pg,"document.querySelector('[data-act=new-char]').click()");pg.wait_for_timeout(200)
  run(pg,"document.querySelector('[data-act=new-game][data-v=\"2014\"]').click()");run(pg,"document.querySelector('[data-act=creator]').click()");pg.wait_for_timeout(1500)
  cr_to(pg,"Class")
  cls=run(pg,"[...document.querySelectorAll('[data-cr=cls]')].map(b=>b.dataset.v)")
  ok(len(cls)>5 and "Binder" not in cls,"campaign with the book off hides its class")
  run(pg,"document.querySelector('[data-cr=cancel]').click()");pg.wait_for_timeout(200)
  run(pg,"document.querySelector('[data-act=camp-src]').click()");pg.wait_for_timeout(200)
  run(pg,"(()=>{const i=document.querySelector('[data-act=lib-pack][data-camp=k1]');i.checked=true;i.dispatchEvent(new Event('change',{bubbles:true}))})()");pg.wait_for_timeout(200)
  run(pg,"document.querySelector('[data-act=new-char]').click()");pg.wait_for_timeout(200)
  run(pg,"document.querySelector('[data-act=new-game][data-v=\"2014\"]').click()");run(pg,"document.querySelector('[data-act=creator]').click()");pg.wait_for_timeout(1500)
  cr_to(pg,"Class","Half-Elf")
  cls=run(pg,"[...document.querySelectorAll('[data-cr=cls]')].map(b=>b.dataset.v)")
  ok("Binder" in cls,"campaign with the book on shows its class "+str(cls)+" "+str(json.loads(run(pg,"localStorage.getItem('character-ledger-v1')"))["campaigns"]))
  steps=run(pg,"[...document.querySelectorAll('#crOv .crprog span')].map(s=>s.textContent)")
  ok("Choices" in steps,f"creator has a Choices step for Half-Elf {steps}")
  S2=json.loads(run(pg,"localStorage.getItem('character-ledger-v1')"))
  ok(S2["campaigns"][0].get("srcs",{}).get("Valda Test")==True,"campaign keeps its books")
  ch=base(features=[{"id":"x1","name":"Wanderer's Gift","source":"Valda Test","desc":"You learn one language of your choice and gain proficiency in two skills of your choice."}])
  pg=load(pg,ch,LIB)
  tag=run(pg,"!!document.querySelector('#featBox .chtag')")
  ok(tag,"sheet shows Choose on a feature with an open choice")
  run(pg,"document.querySelector('#featBox details.item summary').click()");pg.wait_for_timeout(150)
  run(pg,"document.querySelector('[data-act=ch-open]').click()");pg.wait_for_timeout(800)
  fill(pg)
  for i in range(0):
    run(pg,"(()=>{for(const p of document.querySelectorAll('#lvlOv .chlbl')){const m=p.textContent.match(/\\((\\d+) of (\\d+)\\)/);if(m&&+m[1]<+m[2]){const b=p.nextElementSibling.querySelector('[data-ch]:not(.on)');if(b){b.click();return}}}})()");pg.wait_for_timeout(150)
  run(pg,"document.querySelector('[data-chx=ok]').click()");pg.wait_for_timeout(300)
  cc=chars(pg)[0]; f=[x for x in cc["features"] if x["name"]=="Wanderer's Gift"][0]
  ok(f.get("chDone") and len(f.get("chosen",[]))==2,"sheet choice saved: "+str(f.get("chosen")))
  ok(sum(1 for v in cc["skills"].values() if v)>=4,"sheet choice added skills")

  # 7) old characters: options that were separate features move onto the feature that gave them
  old=base(rules="2024",classes=[{"id":"c1","name":"Fighter","sub":"","level":2}],features=[{"id":"a","name":"Fighting Style","source":"Warden 2","desc":"Choose one."},{"id":"b","name":"Fighting Style: Protection","source":"Warden 2","desc":"Impose disadvantage."},{"id":"d","name":"Sentinel's Stand","source":"Warden 1","desc":"x"},{"id":"e","name":"Sentinel's Stand: Primal Toughness","source":"Warden 1","desc":"y"},{"id":"g","name":"Spellcasting: Bard","source":"Bard 1","desc":"z"}])
  pg=load(pg,old,LIB)
  names=run(pg,"[...document.querySelectorAll('#featBox details.item .sum-t')].map(e=>e.textContent)")
  ok("Fighting Style: Protection" not in names and "Sentinel's Stand: Primal Toughness" not in names and "Spellcasting: Bard" in names,"old options merged "+str(names))
  picks=run(pg,"[...document.querySelectorAll('#featBox .chpick')].map(e=>e.textContent)")
  ok("Protection" in picks and "Primal Toughness" in picks,"choice shown on its feature "+str(picks))
  print("errors",errs)
  ok(not errs,"page errors")
finally:
  p.kill()
print("FAILS",len(fails))
sys.exit(1 if fails else 0)
