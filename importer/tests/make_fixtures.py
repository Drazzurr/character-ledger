"""Builds small synthetic test PDFs for the importer.

All text here is original (invented spells, items and rules), so the fixtures
contain no copyrighted book content. Run with:  python3 importer/tests/make_fixtures.py
Requires reportlab and Pillow.
"""
import io
import os

from reportlab.lib.colors import Color, HexColor
from reportlab.lib.pagesizes import letter
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

OUT = os.path.join(os.path.dirname(__file__), "fixtures")
os.makedirs(OUT, exist_ok=True)

W, H = letter
M = 54            # page margin
GUT = 18          # column gutter
COLW = (W - 2 * M - GUT) / 2
RED = HexColor("#7a200d")
BODY = ("Times-Roman", 9.5)
LEAD = 11.5


def wrap(c, text, font, size, width):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if c.stringWidth(t, font, size) <= width:
            cur = t
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


class Flow:
    """Very small two-column text flow."""

    def __init__(self, c, top):
        self.c, self.col, self.top = c, 0, top
        self.y = top

    @property
    def x(self):
        return M + self.col * (COLW + GUT)

    def need(self, h):
        if self.y - h < M + 20:
            if self.col == 0:
                self.col, self.y = 1, self.top
            else:
                raise RuntimeError("page full")

    def heading(self, text, size=13, color=RED, font="Times-Bold"):
        self.need(size + 8)
        self.y -= size + 4
        self.c.setFillColor(color)
        self.c.setFont(font, size)
        self.c.drawString(self.x, self.y, text)
        self.c.setFillColor(Color(0, 0, 0))
        self.y -= 3

    def line(self, parts, size=BODY[1]):
        """parts = [(text, font)] drawn on one line."""
        self.need(LEAD)
        self.y -= LEAD
        x = self.x
        for text, font in parts:
            self.c.setFont(font, size)
            self.c.drawString(x, self.y, text)
            x += self.c.stringWidth(text, font, size)

    def para(self, text, label=None, italic=False, hyphen_at=None):
        font = "Times-Italic" if italic else BODY[0]
        first_w = COLW
        lab = ""
        if label:
            lab = label + " "
            first_w = COLW - self.c.stringWidth(lab, "Times-Bold", BODY[1])
        lines = wrap(self.c, text, font, BODY[1], COLW)
        # re-wrap first line to leave room for the label
        if label:
            words = text.split()
            first, rest = [], []
            for i, w in enumerate(words):
                t = " ".join(first + [w])
                if self.c.stringWidth(t, font, BODY[1]) <= first_w:
                    first.append(w)
                else:
                    rest = words[i:]
                    break
            lines = [" ".join(first)] + wrap(self.c, " ".join(rest), font, BODY[1], COLW)
        if hyphen_at is not None and len(lines) > hyphen_at + 1:
            # force a line-end hyphen split on the first word of the next line
            nxt = lines[hyphen_at + 1].split(" ", 1)
            w = nxt[0]
            if len(w) > 5:
                cut = len(w) // 2
                lines[hyphen_at] += " " + w[:cut] + "-"
                lines[hyphen_at + 1] = w[cut:] + (" " + nxt[1] if len(nxt) > 1 else "")
        for i, ln in enumerate(lines):
            if i == 0 and label:
                self.line([(lab, "Times-Bold"), (ln, font)])
            else:
                self.line([(ln, font)])
        self.y -= 4


def furniture(c, label, head):
    c.setFont("Helvetica", 7.5)
    c.setFillColor(HexColor("#555555"))
    c.drawString(M, H - 34, head.upper())
    c.drawCentredString(W / 2, 30, label)
    c.setFillColor(Color(0, 0, 0))


SPELLS = [
    ("Emberlight Lance", "2nd-level evocation", "1 action", "90 feet", "V, S, M (a scorched iron nail)", "Instantaneous",
     "A spear of banked firelight leaps from your hand toward a creature you can see within range. Make a ranged spell attack. "
     "On a hit, the target takes 3d8 fire damage and sheds dim light in a 10-foot radius until the start of your next turn, "
     "and attack rolls against it have advantage while it glows. Flammable objects the lance touches smolder but do not ignite.",
     "When you cast this spell using a spell slot of 3rd level or higher, the damage increases by 1d8 for each slot level above 2nd."),
    ("Whisper of the Tidewell", "Cantrip divination", "1 bonus action", "Self", "V", "1 round",
     "You attune your hearing to the movement of nearby water. Until the end of your next turn, you know the direction and rough "
     "distance of every body of water within 300 feet of you that holds at least a gallon, including water held in containers "
     "and inside creatures that are not constructs or undead.", None),
    ("Lattice of Stilled Hours", "4th-level abjuration (ritual)", "1 minute", "30 feet", "V, S, M (an hourglass with no sand)",
     "Concentration, up to 1 hour",
     "Fine silver threads spread across a 20-foot cube you choose within range. Creatures inside the cube cannot be aged by magic, "
     "and any disease or poison already affecting a creature in the cube is suspended for the duration. A creature that leaves "
     "the cube resumes its afflictions where they left off. The threads can be seen but not touched, and they ignore wind and water.",
     "When you cast this spell using a spell slot of 6th level or higher, the duration becomes 8 hours and you no longer need to concentrate."),
]


def spell(f, s):
    name, school, time, rng, comp, dur, desc, higher = s
    f.heading(name, size=12)
    f.line([(school, "Times-Italic")])
    f.y -= 2
    f.line([("Casting Time: ", "Times-Bold"), (time, BODY[0])])
    f.line([("Range: ", "Times-Bold"), (rng, BODY[0])])
    f.line([("Components: ", "Times-Bold"), (comp, BODY[0])])
    f.line([("Duration: ", "Times-Bold"), (dur, BODY[0])])
    f.y -= 4
    f.para(desc, hyphen_at=1)
    if higher:
        f.para(higher, label="At Higher Levels.", italic=False)


def table(c, x, y, title, rows, colw):
    c.setFillColor(RED)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(x, y, title)
    y -= 6
    for i, r in enumerate(rows):
        y -= 12
        if i % 2 == 1:
            c.setFillColor(HexColor("#e0e5c1"))
            c.rect(x - 2, y - 3, sum(colw) + 4, 12, stroke=0, fill=1)
        c.setFillColor(Color(0, 0, 0))
        cx = x
        for j, cell in enumerate(r):
            c.setFont("Helvetica-Bold" if i == 0 else "Helvetica", 8)
            c.drawString(cx, y, cell)
            cx += colw[j]
    return y


def sidebar(c, x, y, w, title, text):
    lines = wrap(c, text, "Helvetica", 8, w - 16)
    h = 30 + 10 * len(lines)
    c.setFillColor(HexColor("#ece3cf"))
    c.setStrokeColor(HexColor("#9a8a6a"))
    c.rect(x, y - h, w, h, stroke=1, fill=1)
    c.setFillColor(Color(0, 0, 0))
    c.setFont("Helvetica-Bold", 9)
    c.drawString(x + 8, y - 16, title)
    c.setFont("Helvetica", 8)
    yy = y - 30
    for ln in lines:
        c.drawString(x + 8, yy, ln)
        yy -= 10
    return y - h


def book():
    path = os.path.join(OUT, "two-column-book.pdf")
    c = canvas.Canvas(path, pagesize=letter)
    c.setTitle("Fixture Grimoire")
    c.setAuthor("Character Ledger tests")
    c.setSubject("Synthetic test book")

    # page i: title page (roman page label)
    c.setFont("Times-Bold", 28)
    c.drawCentredString(W / 2, H / 2 + 40, "The Fixture Grimoire")
    c.setFont("Times-Italic", 12)
    c.drawCentredString(W / 2, H / 2, "An original test book for the importer")
    c.bookmarkPage("title")
    c.addOutlineEntry("Title Page", "title", level=0)
    c.showPage()

    # page 1: chapter opener, two columns of spells
    c.bookmarkPage("ch1")
    c.addOutlineEntry("Chapter 1: Spells", "ch1", level=0)
    furniture(c, "1", "Chapter 1 | Spells")
    c.setFillColor(RED)
    c.setFont("Times-Bold", 22)
    c.drawString(M, H - 80, "Chapter 1: Spells")
    c.setFillColor(Color(0, 0, 0))
    f = Flow(c, H - 96)
    f.para("Spells in this chapter are presented in alphabetical order. Each entry lists the spell's level and school, "
           "followed by how it is cast and what it does.", italic=True)
    f.heading("Spell Descriptions", size=15)
    c.bookmarkPage("spells")
    c.addOutlineEntry("Spell Descriptions", "spells", level=1)
    for s in SPELLS:
        spell(f, s)
    c.showPage()

    # page 2: items with a shaded table and a sidebar
    c.bookmarkPage("ch2")
    c.addOutlineEntry("Chapter 2: Equipment", "ch2", level=0)
    furniture(c, "2", "Chapter 2 | Equipment")
    c.setFillColor(RED)
    c.setFont("Times-Bold", 22)
    c.drawString(M, H - 80, "Chapter 2: Equipment")
    c.setFillColor(Color(0, 0, 0))
    y = table(c, M, H - 112, "Trail Gear", [
        ["Item", "Cost", "Weight"],
        ["Lantern pole", "4 gp", "3 lb."],
        ["Rope ladder (20 ft.)", "2 gp", "8 lb."],
        ["Sealing wax (stick)", "5 sp", "-"],
        ["Tinder drum", "1 gp", "1 lb."],
    ], [120, 50, 50])
    sidebar(c, M + COLW + GUT, H - 104, COLW, "Variant: Worn Gear",
            "Gear bought used costs half price. Each time a worn item is used in a stressful moment, roll a d6; on a 1 it "
            "breaks and must be repaired before it can be used again.")
    f = Flow(c, y - 18)
    f.heading("Magic Items", size=15)
    f.heading("Cloak of the Quiet Road", size=12)
    f.line([("Wondrous item, uncommon (requires attunement)", "Times-Italic")])
    f.y -= 3
    f.para("While wearing this grey travelling cloak, you leave no tracks on soft ground and your footsteps make no sound. "
           "You can use a bonus action to raise the hood; while it is up, creatures more than 30 feet away have disadvantage "
           "on Wisdom (Perception) checks made to see you.")
    f.heading("Tidewell Flask", size=12)
    f.line([("Wondrous item, rare", "Times-Italic")])
    f.y -= 3
    f.para("This blue glass flask holds a gallon of fresh water and refills itself each dawn. As an action, you can pour "
           "it out as a 15-foot line of rushing water. Each creature in the line must succeed on a DC 14 Strength saving "
           "throw or be knocked prone.", hyphen_at=0)
    c.showPage()

    c.save()
    _page_labels(path)
    return path


def _page_labels(path):
    """Adds page labels (i for the title page, then 1, 2, ...) with qpdf if available."""
    try:
        import subprocess
        tmp = path + ".tmp"
        subprocess.run(["qpdf", path, "--set-page-labels", "1:r", "2:D", "--", tmp],
                       check=True, capture_output=True)
        os.replace(tmp, path)
    except Exception as e:  # noqa: BLE001
        print("page labels not added:", e)


def scanned():
    """One page that is only a picture of text, so it has no text layer."""
    from PIL import Image, ImageDraw, ImageFont

    path = os.path.join(OUT, "scanned-page.pdf")
    img = Image.new("L", (1700, 2200), 245)
    d = ImageDraw.Draw(img)
    try:
        fb = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf", 46)
        fr = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf", 32)
    except OSError:
        fb = fr = ImageFont.load_default()
    d.text((150, 160), "Ashen Ward", font=fb, fill=20)
    d.text((150, 230), "1st-level abjuration", font=fr, fill=20)
    y = 300
    for ln in ["Casting Time: 1 reaction", "Range: Self", "Components: V, S", "Duration: 1 round",
               "", "A ring of grey ash rises around you. Until the start of", "your next turn, you have resistance to fire damage."]:
        d.text((150, y), ln, font=fr, fill=20)
        y += 48
    img = img.rotate(0.8, fillcolor=245)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    buf.seek(0)
    c = canvas.Canvas(path, pagesize=letter)
    c.drawImage(ImageReader(buf), 0, 0, W, H)
    c.showPage()
    c.save()
    return path


def garbled():
    """A page whose text layer is scrambled, like a PDF with a broken font mapping (should be sent to OCR)."""
    path = os.path.join(OUT, "garbled-text.pdf")
    src = ("A ring of grey ash rises around you. Until the start of your next turn you have resistance to fire damage "
           "and creatures that touch the ash take one point of fire damage. The ash settles when the spell ends. ") * 4
    shift = lambda t: "".join(chr((ord(ch) - 97 + 3) % 26 + 97) if "a" <= ch <= "z" else ch for ch in t)
    c = canvas.Canvas(path, pagesize=letter)
    y = H - M
    for ln in wrap(c, shift(src.lower()), "Times-Roman", 10, W - 2 * M):
        c.setFont("Times-Roman", 10)
        c.drawString(M, y, ln)
        y -= 13
    c.showPage()
    c.save()
    return path


if __name__ == "__main__":
    print(book())
    print(scanned())
    print(garbled())
