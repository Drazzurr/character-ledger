"""Rules checks for Character Ledger. Run from the repo root: python3 tests/rules.py
Loads characters into the app and compares what the sheet shows with values worked out here."""
import subprocess,time,json,sys,math
from playwright.sync_api import sync_playwright
p=subprocess.Popen(['python3','-m','http.server','8790'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);time.sleep(1)
fails=[];n=0
def ok(c,m):
    global n;n+=1
    if not c:fails.append(m)
mod=lambda s:(s-10)//2
pb=lambda l:math.ceil(l/4)+1
def base(**k):
    c={"id":"t1","system":"dnd5e","name":"T","level":1,"rules":"2014","abilities":{"str":10,"dex":10,"con":10,"int":10,"wis":10,"cha":10},"classes":[{"id":"c1","name":"Fighter","level":1}],"hp":10,"hpMax":10,"ac":10,"speed":30}
    c.update(k);return c
def load(pg,c):
    pg.goto('http://localhost:8790/index.html');pg.evaluate("s=>localStorage.setItem('character-ledger-v1',JSON.stringify(s))",{"campaigns":[],"characters":[c],"updated":1});pg.reload();pg.wait_for_timeout(400)
    pg.click('.card');pg.wait_for_timeout(250)
def sheet_vals(pg):
    return pg.evaluate("""()=>({mod:Object.fromEntries([...document.querySelectorAll('[data-mod]')].map(e=>[e.dataset.mod,e.textContent])),save:Object.fromEntries([...document.querySelectorAll('[data-save]')].map(e=>[e.dataset.save,e.textContent])),skill:Object.fromEntries([...document.querySelectorAll('[data-skill]')].map(e=>[e.dataset.skill,e.textContent])),init:(document.querySelector('[data-init]')||{}).textContent})""")
sg=lambda v:("+" if v>=0 else "-")+str(abs(v))
def slots(pg):
    pg.evaluate("document.querySelector('[data-act=tab][data-tab=spells]').click()");pg.wait_for_timeout(250)
    return pg.evaluate("[...document.querySelectorAll('[data-f^=\"spellcasting.slots.\"][data-f$=\".max\"]')].map(e=>+e.value)")
try:
  with sync_playwright() as pw:
    b=pw.chromium.launch();pg=b.new_page(viewport={'width':412,'height':915})
    errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
    # ability mods, saves, skills, expertise at several levels
    for lv in (1,5,9,13,17,20):
        ab={"str":8,"dex":17,"con":14,"int":11,"wis":12,"cha":20}
        c=base(level=lv,abilities=ab,classes=[{"id":"c1","name":"Rogue","level":lv}],saveProf={"dex":1,"int":1},skills={"stealth":2,"athletics":1,"arcana":0})
        load(pg,c);v=sheet_vals(pg);P=pb(lv)
        for k,s in ab.items(): ok(v['mod'][k]==sg(mod(s)),f"L{lv} mod {k} {v['mod'][k]}")
        ok(v['save']['dex']==sg(mod(17)+P),f"L{lv} dex save {v['save']['dex']}")
        ok(v['save']['str']==sg(mod(8)),f"L{lv} str save")
        ok(v['skill']['stealth']==sg(mod(17)+2*P),f"L{lv} expertise {v['skill']['stealth']}")
        ok(v['skill']['athletics']==sg(mod(8)+P),f"L{lv} athletics")
        ok(v['skill']['arcana']==sg(mod(11)),f"L{lv} arcana untrained")
        ok(v['init']==sg(mod(17)),f"L{lv} init {v['init']}")
    # effects: AC, speed, ability, save, initiative
    c=base(abilities={"str":10,"dex":14,"con":10,"int":10,"wis":10,"cha":10},ac=12,speed=30,features=[{"id":"f1","name":"Ring","desc":"","fx":[{"k":"ac","v":1,"c":0},{"k":"speed","v":10,"c":0},{"k":"abil.str","v":2,"c":0},{"k":"save.all","v":1,"c":0},{"k":"init","v":2,"c":0}]}])
    load(pg,c);v=sheet_vals(pg)
    ok(v['mod']['str']=="+1",f"fx abil str {v['mod']['str']}");ok(v['save']['wis']=="+1",f"fx save all {v['save']['wis']}");ok(v['init']=="+4",f"fx init {v['init']}")
    ok(pg.evaluate("document.querySelector('[data-f=ac]')?document.querySelector('[data-f=ac]').value:''")=="12","base AC field unchanged")
    # spell slots
    full={1:[2,0,0,0,0,0,0,0,0],2:[3,0,0,0,0,0,0,0,0],3:[4,2,0,0,0,0,0,0,0],5:[4,3,2,0,0,0,0,0,0],9:[4,3,3,3,1,0,0,0,0],11:[4,3,3,3,2,1,0,0,0],17:[4,3,3,3,2,1,1,1,1],20:[4,3,3,3,3,2,2,1,1]}
    for lv,exp in full.items():
        load(pg,base(level=lv,classes=[{"id":"c1","name":"Wizard","level":lv}],abilities={"str":10,"dex":10,"con":10,"int":16,"wis":10,"cha":10}))
        got=[x for x in slots(pg)];ok(got==[x for x in exp if x] or got==exp or [x for x in got if x]==[x for x in exp if x],f"wizard L{lv} slots {got}")
    half={5:[4,2],9:[4,3,2],13:[4,3,3,1],17:[4,3,3,3,1],20:[4,3,3,3,2]}
    for lv,exp in half.items():
        load(pg,base(level=lv,classes=[{"id":"c1","name":"Paladin","level":lv}]));got=[x for x in slots(pg) if x];ok(got==exp,f"paladin L{lv} slots {got}")
    # multiclass caster level: Wizard 3 + Cleric 2 => caster level 5
    load(pg,base(level=5,classes=[{"id":"c1","name":"Wizard","level":3},{"id":"c2","name":"Cleric","level":2}]));got=[x for x in slots(pg) if x];ok(got==[4,3,2],f"multiclass slots {got}")
    # PF2e
    pf={"id":"p1","system":"pf2e","name":"P","level":5,"cls":"Fighter","race":"Human","pf":{"mods":{"str":4,"dex":2,"con":2,"int":0,"wis":1,"cha":0},"keyAbility":"str","rank":{"perception":2,"fortitude":3,"reflex":2,"will":2,"classDC":1,"unarmored":1,"light":2,"medium":2,"heavy":0,"simple":2,"martial":2,"advanced":0,"unarmed":2,"spell":0},"skills":{"athletics":2,"acrobatics":1},"armor":{"name":"Chain","cat":"medium","ac":4,"dx":1,"ck":0,"sp":0,"st":0,"pot":0}}}
    pg.goto('http://localhost:8790/index.html');pg.evaluate("s=>localStorage.setItem('character-ledger-v1',JSON.stringify(s))",{"campaigns":[],"characters":[pf],"updated":1});pg.reload();pg.wait_for_timeout(400);pg.click('.card');pg.wait_for_timeout(300)
    txt=pg.evaluate("document.body.innerText")
    L=5;prof=lambda r:(L+2*r) if r else 0
    exp_ac=10+min(2,1)+prof(2)+4;exp_fort=2+prof(3);exp_ath=4+prof(2);exp_per=1+prof(2);exp_dc=10+4+prof(1)
    vals=pg.evaluate("Object.fromEntries([...document.querySelectorAll('[data-pfv]')].map(e=>[e.dataset.pfv,e.textContent]))")
    for k,e in {"ac":exp_ac,"fortitude":exp_fort,"skill.athletics":exp_ath,"perception":exp_per,"classDC":exp_dc}.items():
        if k in vals: ok(vals[k].replace("+","")==str(e),f"pf {k} {vals[k]} vs {e}")
    ok(len(vals)>0,"pf values found")
    b.close()
    ok(not errs,f"page errors {errs[:2]}")
finally:p.kill()
print(f"{n} checks, {len(fails)} failed");[print(" -",f) for f in fails]
sys.exit(1 if fails else 0)
