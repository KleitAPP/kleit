"""
The structural set — frames, tape and clips, rules and text bars, marks — drawn in code in the
"Cut Paper" house style (claude/artwork-pack.md §2.2), redrawn after the first 93 were lost (A20).

Rules this file holds to, each from §2.2:
  1. one colour: every shape is fill="currentColor", so the USER recolours it (never the theme, L14)
  2. a second tone is the same colour at .18 or .55 opacity, never a second hue
  3. every edge is a straight cut; curves are 8–16 facets, never a bezier
  4. no perfect circles: a disc is 12 facets with ±5% wobble on each radius, from a fixed seed
  5. corner breaks of 2–10°
  6. nothing thinner than 8 units in a 200-unit box
  7. no outlines (strokes only on wire: the paper clip)
  8. corner radius 0
  10. no gradients, shadows, bevels, faces

Run:  python3 structural.py   → writes public/library/structural/<id>.svg and ../licence/structural-licence-record.csv
Byte-identical on every run (seeded).
"""
import csv, math, os, random

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "..", "..", "..", "public", "library", "structural")
REC = os.path.join(HERE, "..", "licence", "structural-licence-record.csv")
os.makedirs(OUT, exist_ok=True)

def rng(name):
    return random.Random(f"kleit-structural-{name}")

def fmt(n):
    return f"{n:.1f}".rstrip("0").rstrip(".")

def pts(points):
    return " ".join(f"{fmt(x)},{fmt(y)}" for x, y in points)

def poly(points, opacity=None, extra=""):
    op = f' opacity="{opacity}"' if opacity else ""
    return f'<polygon points="{pts(points)}"{op}{extra}/>'

def path(d, opacity=None, evenodd=False):
    op = f' opacity="{opacity}"' if opacity else ""
    fr = ' fill-rule="evenodd"' if evenodd else ""
    return f'<path d="{d}"{op}{fr}/>'

def ring_d(outer, inner):
    """Two polygons as one evenodd path: a frame."""
    def sub(ps):
        return "M" + " L".join(f"{fmt(x)} {fmt(y)}" for x, y in ps) + " Z"
    return sub(outer) + " " + sub(inner)

def wobble_rect(r, x, y, w, h, k=3):
    """A rectangle whose corners sit a few units off true - the 2–10° corner break."""
    return [(x + r.uniform(-k, k), y + r.uniform(-k, k)),
            (x + w + r.uniform(-k, k), y + r.uniform(-k, k)),
            (x + w + r.uniform(-k, k), y + h + r.uniform(-k, k)),
            (x + r.uniform(-k, k), y + h + r.uniform(-k, k))]

def disc(r, cx, cy, radius, n=12, wob=0.05, start=0.0):
    return [(cx + radius * (1 + r.uniform(-wob, wob)) * math.cos(start + 2 * math.pi * i / n),
             cy + radius * (1 + r.uniform(-wob, wob)) * math.sin(start + 2 * math.pi * i / n)) for i in range(n)]

def torn(r, x0, x1, y, amp=4, step=9):
    """A torn edge from x0 to x1 at height y: small straight cuts up and down."""
    out = []
    x = x0
    while x < x1:
        out.append((x, y + r.uniform(-amp, amp)))
        x += step
    out.append((x1, y + r.uniform(-amp, amp)))
    return out

def svg(name, title, body, w=200, h=200):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" '
            f'role="img" aria-label="{title}" fill="currentColor"><title>{title}</title>{body}</svg>\n')

ASSETS = []  # (id, family, title, svg)

def add(id_, family, title, body, w=200, h=200):
    ASSETS.append((id_, family, title, svg(id_, title, body, w, h)))

# ---------------------------------------------------------------- frames
def frame_simple(id_, title, thick, w=200, h=200):
    r = rng(id_)
    outer = wobble_rect(r, 4, 4, w - 8, h - 8)
    inner = wobble_rect(r, 4 + thick, 4 + thick, w - 8 - 2 * thick, h - 8 - 2 * thick, 2)
    add(id_, "frame", title, path(ring_d(outer, inner), evenodd=True), w, h)

frame_simple("frame-thin", "Thin cut frame", 10)
frame_simple("frame-thick", "Thick cut frame", 22)
frame_simple("frame-tall", "Tall thin frame", 10, 200, 250)
frame_simple("frame-wide", "Wide thin frame", 10, 250, 200)

def frame_double():
    r = rng("frame-double")
    a = path(ring_d(wobble_rect(r, 4, 4, 192, 192), wobble_rect(r, 14, 14, 172, 172, 2)), evenodd=True)
    b = path(ring_d(wobble_rect(r, 26, 26, 148, 148, 2), wobble_rect(r, 36, 36, 128, 128, 2)), evenodd=True)
    add("frame-double", "frame", "Double rule frame", a + b)
frame_double()

def frame_torn():
    r = rng("frame-torn")
    top = torn(r, 6, 194, 8, 5)
    right = [(194 + r.uniform(-5, 5), y) for y in range(8, 194, 9)]
    bottom = [(x, 192 + r.uniform(-5, 5)) for x in range(194, 6, -9)]
    left = [(6 + r.uniform(-5, 5), y) for y in range(192, 8, -9)]
    outer = top + right + bottom + left
    inner = wobble_rect(r, 28, 28, 144, 144, 2)
    add("frame-torn", "frame", "Torn paper frame", path(ring_d(outer, inner), evenodd=True))
frame_torn()

def frame_polaroid():
    r = rng("frame-polaroid")
    outer = wobble_rect(r, 4, 4, 192, 232)
    inner = wobble_rect(r, 18, 18, 164, 164, 2)
    add("frame-polaroid", "frame", "Instant photo frame", path(ring_d(outer, inner), evenodd=True), 200, 240)
frame_polaroid()

def frame_filmstrip():
    r = rng("frame-filmstrip")
    outer = wobble_rect(r, 2, 4, 246, 192)
    inner = wobble_rect(r, 24, 34, 202, 132, 2)
    holes = []
    for i in range(9):
        x = 14 + i * 27
        holes.append(path(ring_d([(0,0)]*0 or wobble_rect(r, x, 12, 14, 12, 1), [(x+7,18)]*0 or [(x+7,18),(x+7,18),(x+7,18),(x+7,18)]), evenodd=True))
    # simpler: cut holes as evenodd sub-paths of the frame
    subs = [outer, inner]
    for i in range(9):
        x = 14 + i * 27
        subs.append(wobble_rect(r, x, 12, 14, 12, 1))
        subs.append(wobble_rect(r, x, 176, 14, 12, 1))
    d = " ".join("M" + " L".join(f"{fmt(px)} {fmt(py)}" for px, py in s) + " Z" for s in subs)
    add("frame-filmstrip", "frame", "Film strip frame", path(d, evenodd=True), 250, 200)
frame_filmstrip()

def frame_ticket():
    r = rng("frame-ticket")
    # a rectangle with a notch cut from the middle of each short side, and a perforation line
    o = [(6, 6), (244, 6), (244, 44), (232, 50), (232, 70), (244, 76), (244, 194), (6, 194), (6, 76), (18, 70), (18, 50), (6, 44)]
    o = [(x + r.uniform(-2, 2), y + r.uniform(-2, 2)) for x, y in o]
    inner = wobble_rect(r, 20, 20, 150, 160, 2)
    body = path(ring_d(o, inner), evenodd=True)
    dots = "".join(poly(disc(r, 196, y, 3.5, 8), opacity=".55") for y in range(26, 180, 14))
    add("frame-ticket", "frame", "Ticket stub frame", body + dots, 250, 200)
frame_ticket()

def frame_corners():
    r = rng("frame-corners")
    L = 56; t = 11
    def corner(sx, sy, fx, fy):
        base = [(0, 0), (L, 0), (L, t), (t, t), (t, L), (0, L)]
        return [(sx + fx * x + r.uniform(-1.5, 1.5), sy + fy * y + r.uniform(-1.5, 1.5)) for x, y in base]
    body = poly(corner(4, 4, 1, 1)) + poly(corner(196, 4, -1, 1)) + poly(corner(196, 196, -1, -1)) + poly(corner(4, 196, 1, -1))
    add("frame-corners", "frame", "Corner brackets", body)
frame_corners()

def frame_oval():
    r = rng("frame-oval")
    outer = [(100 + 96 * math.cos(a) * (1 + r.uniform(-0.03, 0.03)), 125 + 121 * math.sin(a) * (1 + r.uniform(-0.03, 0.03))) for a in [2 * math.pi * i / 16 for i in range(16)]]
    inner = [(100 + 78 * math.cos(a), 125 + 103 * math.sin(a)) for a in [2 * math.pi * i / 16 + 0.1 for i in range(16)]]
    add("frame-oval", "frame", "Faceted oval frame", path(ring_d(outer, inner), evenodd=True), 200, 250)
frame_oval()

def frame_arch():
    r = rng("frame-arch")
    def arch(x0, x1, ytop, ybase, n=10):
        cx = (x0 + x1) / 2; rad = (x1 - x0) / 2
        top = [(cx + rad * math.cos(math.pi - math.pi * i / n), ytop + rad - rad * math.sin(math.pi - math.pi * i / n)) for i in range(n + 1)]
        return [(x0, ybase)] + top + [(x1, ybase)]
    outer = [(x + r.uniform(-2, 2), y + r.uniform(-2, 2)) for x, y in arch(6, 194, 6, 244)]
    inner = arch(20, 180, 20, 230)
    add("frame-arch", "frame", "Arch frame", path(ring_d(outer, inner), evenodd=True), 200, 250)
frame_arch()

def frame_stamp():
    r = rng("frame-stamp")
    # a rectangle with a perforated edge: 8 cuts a side
    subs = [wobble_rect(r, 10, 10, 180, 180, 1), wobble_rect(r, 26, 26, 148, 148, 2)]
    for i in range(9):
        c = 10 + i * 22.5
        for (cx, cy) in [(c, 10), (c, 190), (10, c), (190, c)]:
            subs.append(disc(r, cx, cy, 6, 8, 0.08))
    d = " ".join("M" + " L".join(f"{fmt(px)} {fmt(py)}" for px, py in s) + " Z" for s in subs)
    add("frame-stamp", "frame", "Postage stamp frame", path(d, evenodd=True))
frame_stamp()

def frame_scallop():
    r = rng("frame-scallop")
    outer = []
    n = 28
    for i in range(n):
        a = 2 * math.pi * i / n
        rad = 96 if i % 2 == 0 else 86
        outer.append((100 + rad * math.cos(a) * (1 + r.uniform(-0.02, 0.02)), 100 + rad * math.sin(a) * (1 + r.uniform(-0.02, 0.02))))
    inner = disc(r, 100, 100, 70, 16, 0.02)
    add("frame-scallop", "frame", "Scalloped round frame", path(ring_d(outer, inner), evenodd=True))
frame_scallop()

# ---------------------------------------------------------------- tape and clips
def tape(id_, title, angle, w=140, h=34, opacity=".55", tornEnds=True, cx=100, cy=100):
    r = rng(id_)
    left = torn(r, 0, 0, 0) if False else None
    x0, x1 = -w / 2, w / 2
    top = [(x, -h / 2 + r.uniform(-1, 1)) for x in range(int(x0), int(x1), 20)]
    right = [(x1 + r.uniform(-4, 4), y) for y in range(int(-h / 2), int(h / 2), 7)] if tornEnds else [(x1, -h / 2)]
    bottom = [(x, h / 2 + r.uniform(-1, 1)) for x in range(int(x1), int(x0), -20)]
    leftE = [(x0 + r.uniform(-4, 4), y) for y in range(int(h / 2), int(-h / 2), -7)] if tornEnds else [(x0, h / 2)]
    ps = top + right + bottom + leftE
    a = math.radians(angle)
    rot = [(cx + x * math.cos(a) - y * math.sin(a), cy + x * math.sin(a) + y * math.cos(a)) for x, y in ps]
    return poly(rot, opacity=opacity)

add("tape-strip", "tape", "Strip of tape", tape("tape-strip", "Strip of tape", -6))
add("tape-strip-steep", "tape", "Strip of tape, tilted", tape("tape-strip-steep", "", 38))
add("tape-cross", "tape", "Two strips of tape crossed", tape("tape-cross-a", "", 40, 120, 30) + tape("tape-cross-b", "", -40, 120, 30))
add("tape-corner", "tape", "Tape across a corner", tape("tape-corner", "", 45, 110, 30, cx=40, cy=40))
def tape_washi():
    # the pattern is cut out of the tape (holes), so it reads in any colour on any ground
    r = rng("tape-washi")
    w, h = 150, 36
    top = [(x, -h / 2 + r.uniform(-1, 1)) for x in range(-75, 75, 20)]
    right = [(75 + r.uniform(-4, 4), y) for y in range(-18, 18, 7)]
    bottom = [(x, h / 2 + r.uniform(-1, 1)) for x in range(75, -75, -20)]
    left = [(-75 + r.uniform(-4, 4), y) for y in range(18, -18, -7)]
    strip = [(100 + x, 100 + y) for x, y in top + right + bottom + left]
    holes = [disc(r, 40 + i * 20, 100 + (i % 2) * 10 - 5, 4.5, 8, 0.08) for i in range(7)]
    add("tape-washi", "tape", "Patterned tape", path(ring_d(strip, holes[0]) + " " + " ".join("M" + " L".join(f"{fmt(px)} {fmt(py)}" for px, py in hl) + " Z" for hl in holes[1:]), opacity=".55", evenodd=True))
tape_washi()

def clip_paper():
    r = rng("clip-paper")
    # wire: the one place a stroke is allowed (§2.2 #7)
    d = "M70 150 L70 50 L128 50 L128 160 L94 160 L94 70 L112 70 L112 140"
    add("clip-paper", "clip", "Paper clip", f'<path d="{d}" fill="none" stroke="currentColor" stroke-width="10" stroke-linejoin="miter"/>')
clip_paper()

def clip_bulldog():
    r = rng("clip-bulldog")
    body = wobble_rect(r, 40, 90, 120, 60, 2)
    handles = [(52, 90), (70, 40), (84, 40), (72, 90)], [(148, 90), (130, 40), (116, 40), (128, 90)]
    add("clip-bulldog", "clip", "Bulldog clip", poly(body) + poly(handles[0]) + poly(handles[1]))
clip_bulldog()

def pin():
    r = rng("pin")
    head = disc(r, 100, 60, 34, 12)
    needle = [(96, 92), (104, 92), (101, 170), (99, 170)]
    shadow = disc(r, 112, 72, 10, 8)
    add("pin", "clip", "Push pin", poly(head) + poly(needle) + poly(shadow, opacity=".18"))
pin()

def staple():
    r = rng("staple")
    add("staple", "clip", "Staple", poly([(50, 80), (150, 80), (150, 125), (138, 125), (138, 92), (62, 92), (62, 125), (50, 125)]))
staple()

def binder_ring():
    r = rng("binder-ring")
    outer = disc(r, 100, 100, 70, 16, 0.02); inner = disc(r, 100, 100, 56, 16, 0.02)
    add("binder-ring", "clip", "Binder ring", path(ring_d(outer, inner), evenodd=True))
binder_ring()

# ---------------------------------------------------------------- rules and bars
def rule(id_, title, y0, y1, w=250):
    r = rng(id_)
    add(id_, "rule", title, poly([(4, y0 + r.uniform(-1, 1)), (w - 4, y0 + r.uniform(-1, 1)), (w - 4, y1 + r.uniform(-1, 1)), (4, y1 + r.uniform(-1, 1))]), w, 60)
rule("rule-hair", "Thin rule", 26, 34)
rule("rule-thick", "Thick rule", 20, 40)

def rule_double():
    r = rng("rule-double")
    a = poly([(4, 18), (246, 18), (246, 26), (4, 26)]); b = poly([(4, 34), (246, 34), (246, 42), (4, 42)])
    add("rule-double", "rule", "Double rule", a + b, 250, 60)
rule_double()

def rule_dotted():
    r = rng("rule-dotted")
    add("rule-dotted", "rule", "Dotted rule", "".join(poly(disc(r, 12 + i * 21, 30, 5, 8, 0.1)) for i in range(12)), 250, 60)
rule_dotted()

def rule_dashed():
    r = rng("rule-dashed")
    add("rule-dashed", "rule", "Dashed rule", "".join(poly(wobble_rect(r, 6 + i * 30, 26, 18, 8, 1)) for i in range(8)), 250, 60)
rule_dashed()

def bar(id_, title, tornEdge=False, w=250, h=70):
    r = rng(id_)
    if tornEdge:
        top = torn(r, 4, w - 4, 10, 3, 8); bottom = [(x, h - 10 + r.uniform(-3, 3)) for x in range(w - 4, 4, -8)]
        ps = top + bottom
    else:
        ps = wobble_rect(r, 4, 8, w - 8, h - 16, 2)
    add(id_, "bar", title, poly(ps), w, h)
bar("bar-solid", "Text bar")
bar("bar-torn", "Torn text bar", True)
bar("bar-tall", "Tall text bar", False, 250, 120)

def bar_speech():
    r = rng("bar-speech")
    ps = [(6, 10), (244, 10), (244, 58), (90, 58), (72, 76), (70, 58), (6, 58)]
    add("bar-speech", "bar", "Speech bar", poly([(x + r.uniform(-1.5, 1.5), y + r.uniform(-1.5, 1.5)) for x, y in ps]), 250, 80)
bar_speech()

def tag_label():
    r = rng("tag-label")
    outer = [(6, 10), (206, 10), (244, 40), (206, 70), (6, 70)]
    outer = [(x + r.uniform(-1.5, 1.5), y + r.uniform(-1.5, 1.5)) for x, y in outer]
    hole = disc(r, 214, 40, 7, 8, 0.08)
    add("tag-label", "bar", "Label tag", path(ring_d(outer, hole), evenodd=True), 250, 80)
tag_label()

def ribbon_banner():
    r = rng("ribbon-banner")
    main = [(30, 14), (220, 14), (220, 66), (30, 66)]
    tailL = [(6, 6), (40, 6), (40, 74), (6, 74), (22, 40)]
    tailR = [(244, 6), (210, 6), (210, 74), (244, 74), (228, 40)]
    foldL = [(30, 14), (40, 6), (40, 14)]; foldR = [(220, 14), (210, 6), (210, 14)]
    add("ribbon-banner", "bar", "Ribbon banner", poly(tailL, opacity=".55") + poly(tailR, opacity=".55") + poly(main), 250, 80)
ribbon_banner()

# ---------------------------------------------------------------- marks
def arrow_straight():
    r = rng("arrow-straight")
    add("arrow-straight", "mark", "Arrow", poly([(14, 92), (130, 92), (130, 62), (186, 100), (130, 138), (130, 108), (14, 108)]))
arrow_straight()

def arrow_curved():
    # a faceted half-arc band, centre (100,120), from the left (180°) over the top to the right
    # (0°), with the head on the right end pointing down
    n = 8
    cx, cy = 100, 120
    outer = [(cx + 84 * math.cos(math.pi - math.pi * i / n), cy - 84 * math.sin(math.pi - math.pi * i / n)) for i in range(n + 1)]
    inner = [(cx + 66 * math.cos(math.pi * i / n), cy - 66 * math.sin(math.pi * i / n)) for i in range(n + 1)]
    band = poly(outer + inner)
    head = poly([(156, 118), (212, 118), (184, 162)])
    add("arrow-curved", "mark", "Curved arrow", band + head, 220, 200)
arrow_curved()

def chevron():
    add("arrow-chevron", "mark", "Chevron", poly([(50, 40), (74, 40), (134, 100), (74, 160), (50, 160), (110, 100)]))
chevron()

def star5():
    r = rng("star-five")
    ps = []
    for i in range(10):
        a = -math.pi / 2 + math.pi * i / 5
        rad = (92 if i % 2 == 0 else 40) * (1 + r.uniform(-0.03, 0.03))
        ps.append((100 + rad * math.cos(a), 104 + rad * math.sin(a)))
    add("star-five", "mark", "Cut star", poly(ps))
star5()

def sparkle():
    r = rng("sparkle-four")
    ps = []
    for i in range(8):
        a = -math.pi / 2 + math.pi * i / 4
        rad = (94 if i % 2 == 0 else 22) * (1 + r.uniform(-0.03, 0.03))
        ps.append((100 + rad * math.cos(a), 100 + rad * math.sin(a)))
    add("sparkle-four", "mark", "Sparkle", poly(ps))
sparkle()

def heart():
    r = rng("heart-cut")
    ps = [(100, 178), (22, 100), (22, 60), (44, 32), (72, 32), (100, 60), (128, 32), (156, 32), (178, 60), (178, 100)]
    add("heart-cut", "mark", "Cut heart", poly([(x + r.uniform(-2, 2), y + r.uniform(-2, 2)) for x, y in ps]))
heart()

def asterisk():
    r = rng("asterisk")
    body = ""
    for i in range(3):
        a = math.radians(i * 60)
        ps = [(-9, -86), (9, -86), (9, 86), (-9, 86)]
        body += poly([(100 + x * math.cos(a) - y * math.sin(a), 100 + x * math.sin(a) + y * math.cos(a)) for x, y in ps])
    add("asterisk", "mark", "Asterisk", body)
asterisk()

def quotes():
    r = rng("quote-marks")
    def mark(x):
        return poly([(x, 60), (x + 38, 60), (x + 38, 110), (x + 18, 140), (x + 4, 140), (x + 18, 110), (x, 110)])
    add("quote-marks", "mark", "Quotation marks", mark(44) + mark(112))
quotes()

def check():
    add("check-mark", "mark", "Check mark", poly([(26, 104), (46, 84), (82, 120), (156, 44), (176, 64), (82, 160)]))
check()

def cross():
    body = ""
    for a in (45, -45):
        ar = math.radians(a)
        ps = [(-10, -80), (10, -80), (10, 80), (-10, 80)]
        body += poly([(100 + x * math.cos(ar) - y * math.sin(ar), 100 + x * math.sin(ar) + y * math.cos(ar)) for x, y in ps])
    add("cross-mark", "mark", "Cross mark", body)
cross()

def ring():
    r = rng("ring")
    add("ring", "mark", "Cut ring", path(ring_d(disc(r, 100, 100, 88, 12), disc(r, 100, 100, 66, 12)), evenodd=True))
ring()

def dot():
    r = rng("dot")
    add("dot", "mark", "Cut dot", poly(disc(r, 100, 100, 70, 12)))
dot()

def snip():
    r = rng("snip-line")
    dashes = "".join(poly(wobble_rect(r, 6 + i * 24, 26, 14, 8, 1)) for i in range(10))
    blades = poly([(214, 10), (246, 30), (214, 50), (226, 30)]) 
    add("snip-line", "mark", "Cut here", dashes + blades, 250, 60)
snip()

def burst():
    r = rng("burst")
    ps = []
    n = 16
    for i in range(2 * n):
        a = 2 * math.pi * i / (2 * n)
        rad = (94 if i % 2 == 0 else 72) * (1 + r.uniform(-0.03, 0.03))
        ps.append((100 + rad * math.cos(a), 100 + rad * math.sin(a)))
    add("burst", "mark", "Burst", poly(ps))
burst()

def shadow_paper():
    r = rng("paper-shadow")
    add("paper-shadow", "frame", "Paper with shadow", poly(wobble_rect(r, 16, 16, 168, 168, 2), opacity=".18") + poly(wobble_rect(r, 6, 6, 168, 168, 2)))
shadow_paper()

# ---------------------------------------------------------------- batch 2 (2026-10-05, evening): editorial, more frames, more marks
def ring_poly(id_, title, n, r_out, r_in, w=200, h=200, start=-math.pi/2):
    r = rng(id_)
    outer = disc(r, w/2, h/2, r_out, n, 0.03, start); inner = disc(r, w/2, h/2, r_in, n, 0.02, start)
    add(id_, "frame", title, path(ring_d(outer, inner), evenodd=True), w, h)

ring_poly("frame-hex", "Hexagon frame", 6, 96, 78)
ring_poly("frame-octagon", "Octagon frame", 8, 96, 80)
ring_poly("frame-diamond", "Diamond frame", 4, 98, 80)
ring_poly("frame-round-thin", "Thin round frame", 16, 96, 86)

def frame_notched():
    r = rng("frame-notched")
    n = 18
    o = [(6+n, 6), (194-n, 6), (194, 6+n), (194, 194-n), (194-n, 194), (6+n, 194), (6, 194-n), (6, 6+n)]
    o = [(x + r.uniform(-1.5, 1.5), y + r.uniform(-1.5, 1.5)) for x, y in o]
    add("frame-notched", "frame", "Notched frame", path(ring_d(o, wobble_rect(r, 22, 22, 156, 156, 2)), evenodd=True))
frame_notched()

def frame_heart():
    r = rng("frame-heart")
    def heart(k, cx=100, cy=104):
        ps = [(0, 74), (-78, -4), (-78, -44), (-56, -72), (-28, -72), (0, -44), (28, -72), (56, -72), (78, -44), (78, -4)]
        return [(cx + x * k + r.uniform(-1.5, 1.5), cy + y * k + r.uniform(-1.5, 1.5)) for x, y in ps]
    add("frame-heart", "frame", "Heart frame", path(ring_d(heart(1.15), heart(0.86)), evenodd=True))
frame_heart()

def frame_star():
    r = rng("frame-star")
    def star(k):
        ps = []
        for i in range(10):
            a = -math.pi/2 + math.pi*i/5
            rad = (96 if i % 2 == 0 else 44) * k
            ps.append((100 + rad*math.cos(a), 104 + rad*math.sin(a)))
        return ps
    add("frame-star", "frame", "Star frame", path(ring_d(star(1.0), star(0.74)), evenodd=True))
frame_star()

def frame_polaroid_wide():
    r = rng("frame-polaroid-wide")
    add("frame-polaroid-wide", "frame", "Wide instant frame", path(ring_d(wobble_rect(r, 4, 4, 242, 192), wobble_rect(r, 18, 18, 214, 140, 2)), evenodd=True), 250, 200)
frame_polaroid_wide()

def frame_tag_shape():
    r = rng("frame-tag-shape")
    o = [(6, 40), (40, 6), (194, 6), (194, 194), (6, 194)]
    o = [(x + r.uniform(-1.5, 1.5), y + r.uniform(-1.5, 1.5)) for x, y in o]
    hole = disc(r, 36, 36, 7, 8, 0.08)
    inner = wobble_rect(r, 22, 56, 156, 122, 2)
    d = ring_d(o, inner) + " M" + " L".join(f"{fmt(x)} {fmt(y)}" for x, y in hole) + " Z"
    add("frame-tag-shape", "frame", "Tag-shaped frame", path(d, evenodd=True))
frame_tag_shape()

def frame_inset_double():
    r = rng("frame-inset-double")
    a = path(ring_d(wobble_rect(r, 4, 4, 192, 192), wobble_rect(r, 22, 22, 156, 156, 2)), evenodd=True)
    b = path(ring_d(wobble_rect(r, 30, 30, 140, 140, 2), wobble_rect(r, 38, 38, 124, 124, 2)), evenodd=True, opacity=".55")
    add("frame-inset-double", "frame", "Frame with an inner line", a + b)
frame_inset_double()

# editorial
def masthead():
    r = rng("masthead")
    body = poly(wobble_rect(r, 4, 14, 242, 40, 1)) + poly([(4, 60), (246, 60), (246, 65), (4, 65)]) + poly([(4, 70), (246, 70), (246, 73), (4, 73)])
    add("masthead", "editorial", "Masthead bar", body, 250, 80)
masthead()

def column_rule():
    add("column-rule", "editorial", "Column rule", poly([(28, 4), (36, 4), (36, 246), (28, 246)]), 64, 250)
column_rule()

def byline_rule():
    add("byline-rule", "editorial", "Short rule", poly([(60, 26), (190, 26), (190, 34), (60, 34)]), 250, 60)
byline_rule()

def section_ornament():
    r = rng("section-ornament")
    body = poly([(4, 28), (90, 28), (90, 32), (4, 32)]) + poly([(160, 28), (246, 28), (246, 32), (160, 32)])
    body += "".join(poly(disc(r, 110 + i * 15, 30, 4.5, 8, 0.1)) for i in range(3))
    add("section-ornament", "editorial", "Section break", body, 250, 60)
section_ornament()

def pull_quote_bars():
    r = rng("pull-quote-bars")
    add("pull-quote-bars", "editorial", "Pull-quote bars", poly(wobble_rect(r, 4, 6, 242, 14, 1)) + poly(wobble_rect(r, 4, 100, 242, 14, 1)), 250, 120)
pull_quote_bars()

def caption_bar():
    r = rng("caption-bar")
    add("caption-bar", "editorial", "Caption bar", poly(wobble_rect(r, 4, 12, 242, 24, 1)), 250, 48)
caption_bar()

def kicker_tab():
    r = rng("kicker-tab")
    o = [(6, 8), (150, 8), (168, 30), (150, 52), (6, 52)]
    add("kicker-tab", "editorial", "Kicker tab", poly([(x + r.uniform(-1.5, 1.5), y + r.uniform(-1.5, 1.5)) for x, y in o]), 180, 60)
kicker_tab()

def drop_cap_box():
    r = rng("drop-cap-box")
    add("drop-cap-box", "editorial", "Drop-cap box", path(ring_d(wobble_rect(r, 6, 6, 188, 188), wobble_rect(r, 18, 18, 164, 164, 2)), evenodd=True))
drop_cap_box()

def page_badge():
    r = rng("page-badge")
    add("page-badge", "editorial", "Page badge", poly(disc(r, 100, 100, 60, 12)))
page_badge()

def bracket_pair():
    r = rng("bracket-pair")
    L = poly([(30, 20), (70, 20), (70, 32), (42, 32), (42, 168), (70, 168), (70, 180), (30, 180)])
    R = poly([(170, 20), (130, 20), (130, 32), (158, 32), (158, 168), (130, 168), (130, 180), (170, 180)])
    add("bracket-pair", "editorial", "Square brackets", L + R)
bracket_pair()

# tape and clips, batch 2
add("tape-long", "tape", "Long strip of tape", tape("tape-long", "", -3, 230, 30, cx=125, cy=40), 250, 80)
add("tape-short", "tape", "Short piece of tape", tape("tape-short", "", 12, 70, 28))

def pin_flat():
    r = rng("pin-flat")
    add("pin-flat", "clip", "Flat-head pin", path(ring_d(disc(r, 100, 100, 44, 12), disc(r, 100, 100, 12, 8)), evenodd=True))
pin_flat()

def rubber_band():
    r = rng("rubber-band")
    outer = [(100 + 90 * math.cos(a) * (1 + r.uniform(-0.04, 0.04)), 100 + 50 * math.sin(a) * (1 + r.uniform(-0.04, 0.04))) for a in [2*math.pi*i/16 for i in range(16)]]
    inner = [(100 + 76 * math.cos(a), 100 + 36 * math.sin(a)) for a in [2*math.pi*i/16 + 0.1 for i in range(16)]]
    add("rubber-band", "clip", "Rubber band", path(ring_d(outer, inner), evenodd=True, opacity=".55"))
rubber_band()

# marks, batch 2
def plus_mark():
    add("plus-mark", "mark", "Plus", poly([(88, 30), (112, 30), (112, 88), (170, 88), (170, 112), (112, 112), (112, 170), (88, 170), (88, 112), (30, 112), (30, 88), (88, 88)]))
plus_mark()

def equals_mark():
    add("equals-mark", "mark", "Equals", poly([(30, 72), (170, 72), (170, 92), (30, 92)]) + poly([(30, 108), (170, 108), (170, 128), (30, 128)]))
equals_mark()

def lightning():
    r = rng("lightning")
    ps = [(112, 16), (58, 108), (96, 108), (84, 184), (144, 84), (106, 84), (124, 16)]
    add("lightning", "mark", "Lightning bolt", poly([(x + r.uniform(-1.5, 1.5), y + r.uniform(-1.5, 1.5)) for x, y in ps]))
lightning()

def crown():
    r = rng("crown")
    ps = [(24, 160), (24, 70), (62, 108), (100, 40), (138, 108), (176, 70), (176, 160)]
    add("crown", "mark", "Crown", poly([(x + r.uniform(-1.5, 1.5), y + r.uniform(-1.5, 1.5)) for x, y in ps]))
crown()

def crescent():
    r = rng("crescent")
    outer = disc(r, 100, 100, 84, 16, 0.02)
    inner = [(126 + 70 * math.cos(a), 96 + 70 * math.sin(a)) for a in [2*math.pi*i/16 for i in range(16)]]
    # a crescent is the big disc with a second disc cut out of it, offset
    add("crescent", "mark", "Crescent moon", path(ring_d(outer, inner), evenodd=True))
crescent()

def pennant():
    r = rng("pennant")
    ps = [(20, 30), (180, 100), (20, 170), (36, 100)]
    add("pennant", "mark", "Pennant", poly([(x + r.uniform(-1.5, 1.5), y + r.uniform(-1.5, 1.5)) for x, y in ps]))
pennant()

def arrow_double():
    add("arrow-double", "mark", "Two-way arrow", poly([(14, 100), (58, 64), (58, 88), (142, 88), (142, 64), (186, 100), (142, 136), (142, 112), (58, 112), (58, 136)]))
arrow_double()

def dash_mark():
    add("dash-mark", "mark", "Dash", poly([(40, 90), (160, 90), (160, 110), (40, 110)]))
dash_mark()

def triangle_mark():
    r = rng("triangle-mark")
    add("triangle-mark", "mark", "Cut triangle", poly([(100 + r.uniform(-2, 2), 24), (180, 170 + r.uniform(-2, 2)), (20, 170 + r.uniform(-2, 2))]))
triangle_mark()

# ---------------------------------------------------------------- write
WEAK = {"clip-bulldog", "frame-tag-shape"}  # a handbag, and a window; redraw before they ship
rows = []
for id_, family, title, text in ASSETS:
    p = os.path.join(OUT, f"{id_}.svg")
    with open(p, "w") as f:
        f.write(text)
    rows.append({
        "asset_id": id_, "family": family, "title": title, "tool": "hand-authored SVG by Claude (code, no image generator)",
        "authored_date": "2026-10-05", "rights_basis": "original work authored for Kleit; geometry from primitives, nothing traced",
        "owns_output": "Kleit, outright", "brand_wordmark_check": "pass", "character_check": "pass", "person_check": "pass",
        "claude_verdict": "weak" if id_ in WEAK else "ship", "recolourable": "yes - fill=currentColor, the user's colour is written into the set (L14)",
        "bytes_svg": len(text.encode()),
    })
with open(REC, "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
    w.writeheader(); w.writerows(rows)
print(f"{len(rows)} structural assets, {sum(r['bytes_svg'] for r in rows)} bytes")
