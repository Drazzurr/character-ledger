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
     {"lvl":2,"name":"Seal Rite","desc":"Choose one of the following rites."},
     {"lvl":2,"name":"Seal Rite: Bonded Flame","desc":"Fire seal."},{"lvl":2,"name":"Seal Rite: Bonded Frost","desc":"Cold seal."},{"lvl":2,"name":"Seal Rite: Bonded Storm","desc":"Storm seal."},
     {"lvl":3,"name":"Binder Pact","desc":"Choose a pact subclass."},
     {"lvl":4,"name":"Ability Score Improvement","desc":"Increase scores."},
     {"lvl":5,"name":"Greater Binding","desc":"More binding."}],
   "subclasses":[{"name":"Pact of Ash","features":[{"lvl":3,"name":"Ash Form","desc":"Ashy."},{"lvl":5,"name":"Ash Storm","desc":"Ash storm."}]},
                 {"name":"Pact of Tide","features":[{"lvl":3,"name":"Tide Form","desc":"Wet."}]}]}],
 "spells":[{"id":"vs1","name":"Spirit Bolt","level":0,"school":"Evocation","classes":["Binder"],"desc":"Bolt.","source":"Valda Test"},
           {"id":"vs2","name":"Ghost Chain","level":1,"school":"Conjuration","classes":["Binder"],"desc":"Chain.","source":"Valda Test"},
           {"id":"vs3","name":"Wraith Ward","level":1,"school":"Abjuration","classes":["Binder"],"desc":"Ward.","source":"Valda Test"},
           {"id":"vs4","name":"Soul Lance","level":2,"school":"Necromancy","classes":["Binder"],"desc":"Lance.","source":"Valda Test"}],
 "items":[],
 "sections":[{"id":"vf1","name":"Spirit Touched","source":"Valda Test","kind":"feat","text":"Feat\nPrerequisite: none\nIncrease your Wisdom or Charisma score by 1, to a maximum of 20. You can see spirits."},
   {"id":"vsp1","name":"Veilkin","source":"Valda Test","kind":"species","text":"Veilkin Traits\nAbility Score Increase. Your Charisma score increases by 2.\nAge. They live long.\nSize. Veilkin are Medium.\nSpeed. Your base walking speed is 30 feet.\nDarkvision. You can see in dim light within 60 feet of you as if it were bright light.\nVeil Step. Once per long rest you can teleport 10 feet.\nLanguages. You can speak, read, and write Common and Sylvan.\nSubraces\nDusk Veilkin\nAbility Score Increase. Your Wisdom score increases by 1.\nDusk Sight. Your darkvision extends to 120 feet.\nDawn Veilkin\nAbility Score Increase. Your Strength score increases by 1.\nDawn Blade. You are proficient with longswords."}]}
def run(pg,js,a=None): return pg.evaluate(js,a)
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
        if st=="Choices":
            run(pg,"""(()=>{document.querySelectorAll('#lvlOv .crbody h4').forEach(h=>{const m=h.textContent.match(/choose (\\d+)/i);const n=m?+m[1]:1;const g=h.nextElementSibling;if(!g)return;const cs=[...g.querySelectorAll('.crc')];cs.filter(x=>!x.classList.contains('on')).slice(0,n-cs.filter(x=>x.classList.contains('on')).length).forEach(x=>x.click())})})()""")
            pg.wait_for_timeout(150)
            run(pg,"""(()=>{document.querySelectorAll('#lvlOv .crbody h4').forEach(h=>{const m=h.textContent.match(/choose (\\d+) \\((\\d+)/i);if(!m)return;let need=+m[1]-+m[2];const g=h.nextElementSibling;[...g.querySelectorAll('.crc:not(.on)')].forEach(x=>{if(need-->0)x.click()})})})()""")
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
        fa=run(pg,"[...document.querySelectorAll('#lvlOv select[data-luf=fa] option')].map(o=>o.value)")
        ok(fa==["","wis","cha"],f"feat ability choice {fa}")
        run(pg,"(()=>{const s=document.querySelector('#lvlOv select[data-luf=fa]');s.value='cha';s.dispatchEvent(new Event('change',{bubbles:true}))})()");pg.wait_for_timeout(200)
    r=step_through(pg); ok(r=="done",f"Binder ->{lv}: {r}")
  print("binder steps",seen)
  c=chars(pg)[0]
  print("binder",c["classes"],c["abilities"]["cha"],[ (f["name"],f["source"],f.get("type")) for f in c["features"]],[s["name"] for s in c["spells"]])
  ok(c["classes"][0]["level"]==5 and c["classes"][0]["sub"],"binder level/sub")
  ok(any(f["name"].startswith("Seal Rite:") for f in c["features"]) and sum(f["name"].startswith("Seal Rite:") for f in c["features"])==1,"binder one seal rite")
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
  print("errors",errs)
  ok(not errs,"page errors")
finally:
  p.kill()
print("FAILS",len(fails))
sys.exit(1 if fails else 0)
