# Homebrew builder and effects

Library > **Homebrew** makes classes, subclasses, species, backgrounds, feats, items and spells inside the app, with rules attached. Entries are saved into the Library in the same shape as imported content, so the character creator, level up, the class picker, the gear picker and the spell picker all use them like SRD options.

## What you can build

| Type | Fields | Where it shows up |
| --- | --- | --- |
| Class | Hit die, saves, skill choices, proficiencies, starting gear, spellcasting (kind, ability, slots, cantrips and spells by level), weapon masteries, features by level (with effects and options), subclasses | Details > Classes, level up, creator |
| Subclass | Parent class (SRD or Library), optional spellcasting, features by level | Subclass choice for that class |
| Species | Size, speed, languages, 2014 ability increases, traits with effects | Creator |
| Background | Skills, tools, starting gear and gold, 5.5e ability choices and origin feat, feature with effects | Creator |
| Feat | Kind (general, origin, fighting style, epic boon), level and ability prerequisites, effects | Level up, creator, Add to character |
| Item | Category, rarity, attunement, weapon damage, armor AC, effects while equipped | Gear picker, Add to character |
| Spell | All spell fields and the class lists it is on | Spell picker, level up, creator |

Every type can **start from an existing entry** (SRD or Library): the text is copied and effects are filled in from the text, ready to adjust. **Open in builder** on any imported feat, species, background, item, spell, class or single-subclass add-on opens it here, so the importer's output can be fixed and given effects; saving updates it in place.

## Effects

An effect is stored on a feature, trait, feat, background or item as `{k, v}` plus optional fields. The sheet applies effects from features (unless switched off) and from equipped items (attuned when required).

| Key | Meaning | Value |
| --- | --- | --- |
| `abil.str` ... `abil.cha` | Ability score increase | amount |
| `abilset.<ab>` | Score becomes this if higher | amount |
| `save.<ab>`, `save.all` | Saving throw bonus | amount |
| `skill.<id>`, `skill.all` | Skill bonus | amount |
| `pskill.<id>`, `eskill.<id>`, `psave.<ab>` | Proficiency, expertise, save proficiency | 1 |
| `ac` | Armor Class bonus | amount |
| `acbase` | Armor Class formula, used when higher than the AC on the sheet | formula |
| `init`, `speed`, `spellatk`, `spelldc` | Bonuses | amount |
| `atk`, `dmg` | Weapon attack and damage bonus (attacks made from gear) | amount |
| `hp`, `hpl` | Max HP, and max HP for every character level | amount |
| `move.fly` etc. | Other speeds | feet, or `"walk"` |
| `sense.darkvision` etc. | Senses | feet |
| `res.<type>`, `imm.<type>` | Damage resistance and immunity | 1 |
| `cimm` | Condition immunity, `n` = condition | 1 |
| `pr.armor`, `pr.weapon`, `pr.tool`, `pr.lang` | Proficiency or language, `n` = name | 1 |
| `pool` | Resource: `n` = name, `r` = `long`, `short` or `manual` | maximum |
| `spell` | Spell always prepared, `n` = spell name | 1 |
| `pick` | Player's choice: `of` (`abil`, `pskill`, `eskill`, `psave`, `res`, `lang`, `tool`), `cnt`, `opts` (empty = any), `sel` (picked), `v` (amount for `abil`) | |

Optional on any effect: `c: 1, cond: "while raging", on: false` makes it conditional. It starts off and the player ticks it on the feature when it applies.

### Amounts

- a number, or `"pb"` for the proficiency bonus;
- a formula: `level` (character level), `clevel` (level in the class whose feature it is, worked out from the feature's source), `pb`, `str dex con int wis cha` (modifiers), `spellmod`, with `+ - * /`, brackets, `min max floor ceil round abs`. Results round down. Examples: `10+dex+con`, `max(1,cha)`, `1+clevel/2`;
- a table by class level: `{by: "clevel", t: "1: 2, 3: 3, 6: 4"}` (typed as `1: 2, 3: 3, 6: 4` in the builder).

### Kept in step automatically

`fxGrants` runs whenever a D&D character is saved or opened:

- each `pool` effect has one resource (tagged `fxk`); its maximum follows the formula, and it goes when the feature or item goes;
- each `spell` effect adds the spell, prepared, filled in from the SRD or Library (tagged `fxk`), and removes it when the source goes;
- `hp` and `hpl` are added to max HP as a running difference (`fxHp`). Characters saved before this existed are assumed to already include their effect HP, so nothing jumps; characters made in the creator start at zero.

### How built effects reach a character

Content is copied onto characters as features with a name and text. `fxAttach` first looks the feature up in an index of homebrew Library entries (by name and text, or text alone when it is long enough) and uses the built effects; only if there is no match does it guess from the text as before. Options picked on a feature (`chFx`) keep their own built effects.

## Sharing

**Export to a file** saves all homebrew, or one source, as `homebrew-<source>.json`:

```json
{"ledgerHomebrew": 1, "source": "...", "entries": {"classes": [], "sections": [], "items": [], "spells": []}}
```

**Import a homebrew file** adds the entries (same id replaces) and turns their sources on for the creator.

## Testing

`python3 tests/homebrew.py` (59 checks): formulas and tables, choices, granted resources and spells, effect HP, the builder for feats, items, classes with subclasses and species, Open in builder, the creator and guided level up with homebrew, export and import, and a phone-width layout check.
