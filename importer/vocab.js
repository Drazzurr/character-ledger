/* Word list for the text-quality check. Built from the rules text already shipped with the app
   (the SRD JSON files), plus common English words, so it needs no extra download. */

const COMMON = `the of and to in a is that for it as was with be by on not he i this are or his from at which but have an they you were her she there
one all we their has been would will can if more when who its out so up said what about into than them only other some could time these two may then
do first any my now such like our over man me even most made after also did many before must through back years where much your way well down should
because each just those people how too little state good very make world still own see men work long get here between both life being under never day
same another know while last might us great old year off come since against go came right used take three himself few house use during without again
place around however home small found thought went say part once general high upon school every does got united left number course war until always away
something fact though water less public put think almost hand enough far took head yet government system better set told nothing night end why called
didn't eyes find going look asked later knew point next program city business give group toward young days let room president side social given present
several order national possible rather second face per among form important often things looking early white case john become large big need four within
felt along children saw best church ever least power development light thing seemed family interest want members mind country area others done turned
although open god service certain kind problem began different door thus help means sense whole matter perhaps itself york times law human line above name
example action company hands local show whether five history gave today either act feet across taken past quite anything seen having death week experience
body word half really field am car words already themselves information tell together college shall money period held keep sure probably free seems real
behind cannot miss political air question making office brought whose special heard major problems ago became federal moment study available known result
street economic boy position reason change south board individual job areas society west close turn love community true court force full seem am instead
able above below upon onto into within without until while whenever wherever whose whom each either neither every enough per via toward towards
creature creatures target targets spell spells level levels damage saving throw throws attack attacks bonus action actions reaction reactions feet foot
range duration concentration ritual components verbal somatic material casting cast caster cantrip cantrips slot slots higher strength dexterity
constitution intelligence wisdom charisma advantage disadvantage proficiency proficient hit points armor class weapon weapons shield magic magical item
items rarity uncommon rare legendary artifact attunement requires short long rest turn turns round rounds minute minutes hour hours radius cone cube
sphere line cylinder emanation fire cold lightning thunder acid poison necrotic radiant force psychic bludgeoning piercing slashing resistance immunity
vulnerability condition conditions blinded charmed deafened frightened grappled incapacitated invisible paralyzed petrified poisoned prone restrained
stunned unconscious exhaustion feature features subclass background species race feat feats proficiencies skill skills tool tools equipment gold`;

let cache = null;

function addWords(set, text) {
  const m = String(text || "").toLowerCase().match(/[a-z][a-z']{2,}/g);
  if (m) for (const w of m) set.add(w.replace(/'s$/, ""));
}

function walk(set, v, depth = 0) {
  if (depth > 8 || v == null) return;
  if (typeof v === "string") addWords(set, v);
  else if (Array.isArray(v)) for (const x of v) walk(set, x, depth + 1);
  else if (typeof v === "object") for (const k in v) walk(set, v[k], depth + 1);
}

/** Returns a Set of known lowercase words. appBase = URL of the app folder (ending in /). */
export async function loadVocab(appBase) {
  if (cache) return cache;
  const set = new Set();
  addWords(set, COMMON);
  const files = ["spells-2014.json", "spells-2024.json", "classes-2014.json", "classes-2024.json",
    "items-2014.json", "items-2024.json", "magic-2014.json", "magic-2024.json"];
  await Promise.all(files.map(async (f) => {
    try {
      const r = await fetch(new URL(f, appBase));
      if (r.ok) walk(set, await r.json());
    } catch (e) { /* offline or missing: the common list still works */ }
  }));
  cache = set;
  return set;
}

/** True when the word (or a simple inflection of it) is known. */
export function knownWord(set, w) {
  w = w.toLowerCase();
  if (set.has(w)) return true;
  for (const suf of ["s", "es", "ed", "d", "ing", "ly", "er", "est"]) {
    if (w.length > suf.length + 2 && w.endsWith(suf) && set.has(w.slice(0, -suf.length))) return true;
  }
  return false;
}
