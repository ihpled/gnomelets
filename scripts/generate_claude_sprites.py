#!/usr/bin/env python3
"""Generate the "Claude Agent" desktop-pet sprites (32 frames).

Usage:
    python3 scripts/generate_claude_sprites.py                  # writes src/images/Claude/0.png..31.png
    python3 scripts/generate_claude_sprites.py --preview OUT    # also writes a labelled contact sheet

Every frame is drawn on a 32x32 logical pixel grid and upscaled 4x with
nearest-neighbour to a 128x128 RGBA PNG (transparent background, alpha is
only ever 0 or 255).  The output is fully deterministic.

Mascot: a coral (#D97757) retro bot / crab-inspired assistant with a boxy
rounded body, two dark eyes with a white highlight, one antenna with a
glowing tip, claw arms and stubby legs, dark outline (#3B2218).

FRAME CONTRACT (index -> content)
   0- 3  walk cycle (contact / passing / contact / passing, body bobs, arms swing)
   4     idle
   5     generic jump/fall (arms out, legs spread, wide eyes)
   6- 7  dragged: dangling from the antenna/head at the top, legs and arms swing
   8-11  typing: hunched behind a tiny glowing laptop, claws alternate, screen glow
  12-15  thinking: eyes up, claw at the face, sparkles orbiting the head
  16-19  happy: squash, hop up, peak with pink hearts, land
  20-23  sleeping: slumped, eyes closed as lines, "zZz" rising and animating
  24-25  sit: perched on an edge, legs dangling and swinging
  26-29  climb: arms alternating overhead, body leaning
  30     jump ascending (arms up, stretched)
  31     fall (arms flailing up, eyes wide)

Baseline: the lowest opaque row of every frame is row 29 (of 32) except the
documented airborne frames 17 and 18 (happy hop / peak), which hover above it.
"""
import argparse
import os
import sys

from PIL import Image, ImageDraw

SIZE = 32
SCALE = 4
BASE_ROW = 29

PAL = {
    'O': (0x3B, 0x22, 0x18),  # outline
    'B': (0xD9, 0x77, 0x57),  # base coral
    'H': (0xF2, 0xA6, 0x86),  # highlight
    'S': (0xA8, 0x52, 0x33),  # shadow
    'W': (0xFF, 0xFF, 0xFF),  # eye glint / letters / screen text
    'G': (0xFF, 0xD9, 0x4A),  # antenna light / sparkles
    'C': (0x5F, 0xE0, 0xF5),  # laptop screen glow
    'D': (0x3C, 0x44, 0x55),  # laptop dark
    'L': (0x9A, 0xA4, 0xB8),  # laptop light
    'P': (0xFF, 0x6F, 0xA8),  # hearts / blush
}


class Cv:
    def __init__(self):
        self.g = [[None] * SIZE for _ in range(SIZE)]

    def get(self, x, y):
        if 0 <= x < SIZE and 0 <= y < SIZE:
            return self.g[y][x]
        return 'X'

    def px(self, x, y, c):
        if 0 <= x < SIZE and 0 <= y < SIZE:
            self.g[y][x] = c

    def px_empty(self, x, y, c):
        if self.get(x, y) is None:
            self.px(x, y, c)

    def rect(self, x, y, w, h, c):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.px(xx, yy, c)

    def outline(self, pts, c='O'):
        """Paint c on empty 4-neighbours of pts."""
        pts = set(pts)
        add = set()
        for (x, y) in pts:
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                n = (x + dx, y + dy)
                if n not in pts and self.get(*n) is None:
                    add.add(n)
        for (x, y) in add:
            self.px(x, y, c)

    def image(self):
        im = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
        for y in range(SIZE):
            for x in range(SIZE):
                k = self.g[y][x]
                if k:
                    im.putpixel((x, y), PAL[k] + (255,))
        return im.resize((SIZE * SCALE, SIZE * SCALE), Image.NEAREST)


# --------------------------------------------------------------------------
# parts
# --------------------------------------------------------------------------
def arm_shape(pose):
    """Pixels (relative to the body's top-left, for the LEFT arm) + claw slit."""
    pts = []
    slit = None

    def r(x0, x1, y0, y1):
        return [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]

    if pose.startswith('drop'):
        n = int(pose[4:] or 0)
        pts = r(-2, -1, 5, 5 + n) + r(-3, -1, 5 + n, 7 + n)
        slit = (-3, 6 + n)
    elif pose == 'up':
        pts = r(-2, -1, -3, 6) + r(-3, -1, -6, -4)
        slit = (-2, -6)
    elif pose == 'mid':
        pts = r(-2, -1, 3, 6) + r(-3, -1, 0, 2)
        slit = (-2, 0)
    elif pose == 'out':
        pts = r(-4, -1, 5, 6) + r(-7, -5, 4, 6)
        slit = (-7, 5)
    elif pose == 'diag':
        for k in range(4):
            pts += [(-2 - k, 5 - k), (-1 - k, 5 - k), (-2 - k, 4 - k)]
        pts += r(-7, -5, -1, 1)
        slit = (-6, -1)
    return pts, slit


def draw_arm(cv, bx, by, w, side, pose):
    pts, slit = arm_shape(pose)
    ab = []
    for (dx, dy) in pts:
        x = bx + dx if side == 'L' else bx + w - 1 - dx
        ab.append((x, by + dy))
    for (x, y) in ab:
        cv.px(x, y, 'B')
    cv.outline(ab)
    if slit:
        x = bx + slit[0] if side == 'L' else bx + w - 1 - slit[0]
        cv.px(x, by + slit[1], 'O')
    # highlight on the claw's first pixel
    if ab:
        x, y = min(ab, key=lambda p: (p[1], p[0]))
        cv.px(x, y, 'H')


def draw_leg(cv, x, top, foot):
    for y in range(top, foot + 1):
        for dx in range(4):
            edge = dx in (0, 3) or y == foot
            if edge:
                c = 'O'
            elif y == foot - 1:
                c = 'S'
            else:
                c = 'B'
            cv.px(x + dx, y, c)


def draw_body(cv, bx, by, w, h):
    for y in range(h):
        for x in range(w):
            if x in (0, w - 1) and y in (0, h - 1):
                continue
            ring = x in (0, w - 1) or y in (0, h - 1)
            inner_corner = x in (1, w - 2) and y in (1, h - 2)
            cv.px(bx + x, by + y, 'O' if ring or inner_corner else 'B')
    for x in range(2, w - 2):
        cv.px(bx + x, by + 1, 'H')
        cv.px(bx + x, by + h - 2, 'S')
    cv.px(bx + 1, by + 2, 'H')
    cv.px(bx + 1, by + 3, 'H')
    cv.px(bx + w - 2, by + h - 3, 'S')
    cv.px(bx + w - 2, by + h - 4, 'S')


def draw_eye(cv, x, y, kind, side):
    if kind == 'open':
        cv.rect(x, y, 3, 4, 'O')
        cv.px(x, y, 'W')
    elif kind == 'look_r':
        cv.rect(x + 1, y, 3, 4, 'O')
        cv.px(x + 3, y, 'W')
    elif kind == 'up':
        cv.rect(x, y - 1, 3, 4, 'O')
        cv.px(x, y - 1, 'W')
        cv.px(x + 1, y - 1, 'W')
    elif kind == 'down':
        cv.rect(x, y + 1, 3, 3, 'O')
        cv.px(x, y + 2, 'W')
    elif kind == 'wide':
        x0 = x - 1 if side == 'L' else x
        cv.rect(x0, y - 1, 4, 5, 'O')
        for cx, cy in ((x0, y - 1), (x0 + 3, y - 1), (x0, y + 3), (x0 + 3, y + 3)):
            cv.px(cx, cy, 'B')
        cv.px(x0 + 1, y, 'W')
        cv.px(x0 + 1, y + 1, 'W')
    elif kind == 'closed':
        cv.rect(x, y + 3, 3, 1, 'O')
    elif kind == 'happy':
        cv.px(x + 1, y + 1, 'O')
        cv.px(x, y + 2, 'O')
        cv.px(x + 2, y + 2, 'O')
        cv.px(x, y + 3, 'O')
        cv.px(x + 2, y + 3, 'O')


def draw_face(cv, bx, by, w, h, eyes, mouth, blush):
    ey = by + int(round(h * 0.28))
    lx = bx + w // 2 - 5
    rx = bx + w // 2 + 2
    draw_eye(cv, lx, ey, eyes, 'L')
    draw_eye(cv, rx, ey, eyes, 'R')
    c = bx + w // 2
    my = ey + 5
    if blush:
        col = blush if isinstance(blush, str) else 'P'
        cv.rect(lx - 2, ey + 4, 2, 1, col)
        cv.rect(rx + 3, ey + 4, 2, 1, col)
    if mouth == 'smile':
        for (x, y) in ((c - 2, my), (c + 1, my), (c - 1, my + 1), (c, my + 1)):
            cv.px(x, y, 'O')
    elif mouth == 'open':
        cv.rect(c - 2, my, 4, 1, 'O')
        cv.rect(c - 1, my + 1, 2, 1, 'O')
    elif mouth == 'o':
        cv.rect(c - 1, my, 2, 2, 'O')
    elif mouth == 'flat':
        cv.rect(c - 1, my + 1, 2, 1, 'O')


def draw_antenna(cv, bx, by, w, offs, glow):
    n = len(offs)
    sx = bx + w // 2 - 1
    for i, o in enumerate(offs):
        y = by - 1 - i
        cv.px(sx + o, y, 'O')
        cv.px(sx + o + 1, y, 'O')
    tx = sx + offs[-1]
    ty = by - n - 2
    tip = [(tx, ty), (tx + 1, ty), (tx, ty + 1), (tx + 1, ty + 1)]
    col = 'G' if glow else 'S'
    for (x, y) in tip:
        cv.px(x, y, col)
    cv.outline(tip)
    if glow:
        cv.px(tx, ty, 'W')
    if glow == 2:
        for (x, y) in ((tx - 2, ty - 1), (tx + 3, ty - 1), (tx - 1, ty - 3), (tx + 2, ty - 3)):
            cv.px_empty(x, y, 'W')


def bot(cv, bx=7, bb=26, w=18, h=14, eyes='open', mouth='smile', blush=True,
        armL='down', armR='down', legs=((0, 29), (0, 29)), offs=(0, 0, 0), glow=1):
    by = bb - h + 1
    if armL:
        draw_arm(cv, bx, by, w, 'L', armL)
    if armR:
        draw_arm(cv, bx, by, w, 'R', armR)
    if legs:
        (dl, fl), (dr, fr) = legs
        draw_leg(cv, bx + 3 + dl, bb, fl)
        draw_leg(cv, bx + w - 7 + dr, bb, fr)
    draw_body(cv, bx, by, w, h)
    draw_face(cv, bx, by, w, h, eyes, mouth, blush)
    draw_antenna(cv, bx, by, w, offs, glow)
    return by


# --------------------------------------------------------------------------
# extras
# --------------------------------------------------------------------------
def sparkle(cv, x, y, s):
    if s == 0:
        pts = [(x, y, 'G')]
    elif s == 1:
        pts = [(x, y, 'W'), (x - 1, y, 'G'), (x + 1, y, 'G'), (x, y - 1, 'G'), (x, y + 1, 'G')]
    else:
        pts = [(x, y, 'W'), (x - 1, y, 'G'), (x + 1, y, 'G'), (x, y - 1, 'G'), (x, y + 1, 'G'),
               (x - 2, y, 'G'), (x + 2, y, 'G'), (x, y - 2, 'G'), (x, y + 2, 'G')]
    pts = [p for p in pts if cv.get(p[0], p[1]) is None]
    for (px, py, c) in pts:
        cv.px(px, py, c)
    cv.outline([(p[0], p[1]) for p in pts])


def heart(cv, x, y, big):
    if big:
        rows = ["##.##", "#####", ".###.", "..#.."]
    else:
        rows = ["#.#", "###", ".#."]
    pts = []
    for dy, row in enumerate(rows):
        for dx, ch in enumerate(row):
            if ch == '#':
                pts.append((x + dx, y + dy))
    for (px, py) in pts:
        cv.px(px, py, 'P')
    cv.outline(pts)
    cv.px(x, y, 'W')


def letter_z(cv, x, y, n):
    pts = []
    for i in range(n):
        pts.append((x + i, y))
        pts.append((x + i, y + n - 1))
    for k in range(1, n - 1):
        pts.append((x + n - 1 - k, y + k))
    for (px, py) in pts:
        cv.px(px, py, 'W')
    cv.outline(pts)


def laptop(cv, lines):
    # base
    for y in range(27, 30):
        for x in range(8, 24):
            if y == 29:
                if 9 <= x <= 22:
                    cv.px(x, y, 'O')
            elif x in (8, 23):
                cv.px(x, y, 'O')
            else:
                cv.px(x, y, 'L' if y == 27 else 'D')
    # screen
    cv.rect(10, 22, 12, 5, 'O')
    cv.rect(11, 23, 10, 3, 'C')
    for (x, y) in lines:
        cv.px(x, y, 'W')
    # keys glint
    for x in (12, 15, 18, 20):
        cv.px(x, 28, 'L')


# --------------------------------------------------------------------------
# frames
# --------------------------------------------------------------------------
def build_frames():
    F = [None] * 32

    # ---- walk 0-3
    def walk(arms, legs, bb, offs):
        cv = Cv()
        bot(cv, bb=bb, eyes='look_r', armL=arms[0], armR=arms[1], legs=legs, offs=offs)
        return cv
    F[0] = walk(('drop0', 'drop2'), ((-1, 29), (1, 29)), 26, (0, 0, 0))
    F[1] = walk(('drop1', 'drop1'), ((0, 29), (0, 28)), 25, (0, 0, 1))
    F[2] = walk(('drop2', 'drop0'), ((-1, 29), (1, 29)), 26, (0, 0, 0))
    F[3] = walk(('drop1', 'drop1'), ((0, 28), (0, 29)), 25, (0, 0, -1))

    # ---- idle 4
    cv = Cv()
    bot(cv, glow=2)
    F[4] = cv

    # ---- generic jump/fall 5
    cv = Cv()
    bot(cv, bb=26, eyes='wide', mouth='o', armL='out', armR='out',
        legs=((-2, 29), (2, 29)), offs=(0, 0, 0))
    F[5] = cv

    # ---- dragged 6-7 (hang from antenna tip at the very top)
    cv = Cv()
    bot(cv, bx=8, bb=24, eyes='wide', mouth='o', armL='diag', armR='drop2',
        legs=((-1, 29), (1, 27)), offs=(0, 0, 0, -1, -1, -1, -1, -1))
    F[6] = cv
    cv = Cv()
    bot(cv, bx=6, bb=24, eyes='wide', mouth='o', armL='drop2', armR='diag',
        legs=((-1, 27), (1, 29)), offs=(0, 0, 0, 1, 1, 1, 1, 1))
    F[7] = cv

    # ---- typing 8-11
    typing = [
        (('up_', 'dn'), [(12, 24), (13, 24), (14, 24), (12, 25), (13, 25)]),
        (('dn', 'dn'), [(12, 24), (13, 24), (16, 24), (17, 24), (12, 25), (13, 25), (14, 25), (15, 25)]),
        (('dn', 'up_'), [(12, 24), (15, 24), (16, 24), (17, 24), (18, 24), (13, 25), (14, 25)]),
        (('dn', 'dn'), [(12, 24), (13, 24), (14, 24), (15, 24), (12, 25), (13, 25), (18, 25), (19, 25)]),
    ]
    for i, ((l, r), lines) in enumerate(typing):
        cv = Cv()
        al = 'drop4' if l == 'up_' else 'drop6'
        ar = 'drop4' if r == 'up_' else 'drop6'
        bot(cv, bb=26, h=13, eyes='down', mouth=None, blush='C', armL=al, armR=ar,
            legs=None, offs=(0, 0, 1 if i % 2 else 0), glow=1 + (i % 2))
        laptop(cv, lines)
        # screen glow spilling on the table
        for x in ((10, 21, 5, 26) if i % 2 == 0 else (11, 20, 4, 27)):
            cv.px_empty(x, 23, 'C')
        F[8 + i] = cv

    # ---- thinking 12-15 (sparkles orbit the head)
    import math
    for f in range(4):
        cv = Cv()
        bot(cv, bb=26, eyes='up', mouth='flat', armL='down', armR='mid',
            offs=(0, 0, 1 if f % 2 else 0), glow=1 + (f % 2))
        for j in range(3):
            a = math.radians(20 + f * 30 + j * 120)
            x = int(round(15.5 + 13 * math.cos(a)))
            y = int(round(13 - 11 * math.sin(a)))
            sparkle(cv, x, y, 2 if (f + j) % 2 == 0 else 1)
        F[12 + f] = cv

    # ---- happy 16-19
    cv = Cv()
    bot(cv, bx=6, w=20, h=11, bb=26, eyes='happy', mouth='open', armL='down', armR='down',
        offs=(0, 0, -1))
    F[16] = cv
    cv = Cv()
    bot(cv, bx=8, w=16, h=15, bb=22, eyes='happy', mouth='open', armL='up', armR='up',
        legs=((0, 25), (0, 25)), offs=(0, 0, 0))
    F[17] = cv
    cv = Cv()
    bot(cv, bb=21, eyes='happy', mouth='open', armL='out', armR='out',
        legs=((1, 24), (-1, 24)), offs=(0, 0, 0), glow=2)
    heart(cv, 1, 4, True)
    heart(cv, 26, 3, True)
    F[18] = cv
    cv = Cv()
    bot(cv, bx=6, w=20, h=12, bb=26, eyes='happy', mouth='open', armL='down', armR='down',
        offs=(0, 0, 1))
    heart(cv, 3, 11, False)
    heart(cv, 26, 8, False)
    F[19] = cv

    # ---- sleeping 20-23
    sleep_h = (12, 13, 13, 12)
    for f in range(4):
        cv = Cv()
        bot(cv, bb=27, h=sleep_h[f], eyes='closed', mouth=None, armL='down', armR='down',
            legs=((0, 29), (0, 29)), offs=(0, 2), glow=0)
        for k, off in enumerate((0.0, 0.5)):
            p = (f / 4.0 + off) % 1.0
            n = 4 if p < 0.3 else (5 if p < 0.65 else 6)
            x = int(round(21 + 5 * p))
            y = int(round(12 - 9 * p))
            letter_z(cv, x, y, n)
        F[20 + f] = cv

    # ---- sit 24-25
    cv = Cv()
    bot(cv, bb=25, eyes='look_r', armL='drop0', armR='drop0',
        legs=((0, 29), (1, 28)), offs=(0, 0, 1))
    F[24] = cv
    cv = Cv()
    bot(cv, bb=24, eyes='look_r', armL='drop0', armR='drop0',
        legs=((-1, 28), (0, 29)), offs=(0, 0, 0))
    F[25] = cv

    # ---- climb 26-29
    climb = [
        ('up', 'down', ((0, 29), (0, 29)), (0, 1, 1)),
        ('mid', 'mid', ((0, 28), (0, 29)), (0, 1, 2)),
        ('down', 'up', ((0, 29), (0, 29)), (0, 1, 1)),
        ('mid', 'mid', ((0, 29), (0, 28)), (0, 1, 2)),
    ]
    for i, (l, r, legs, offs) in enumerate(climb):
        cv = Cv()
        bot(cv, bx=8, bb=26, eyes='up', mouth='flat', armL=l, armR=r, legs=legs, offs=offs)
        F[26 + i] = cv

    # ---- jump ascending 30
    cv = Cv()
    bot(cv, bx=8, w=16, h=16, bb=26, eyes='wide', mouth='open', armL='up', armR='up',
        legs=((1, 29), (-1, 29)), offs=(0, 0, 0))
    F[30] = cv

    # ---- fall 31
    cv = Cv()
    bot(cv, bb=26, eyes='wide', mouth='o', armL='up', armR='diag',
        legs=((-2, 29), (1, 28)), offs=(0, 0, 0))
    F[31] = cv
    return F


def contact_sheet(images):
    names = {0: 'walk', 4: 'idle', 5: 'jump', 6: 'drag', 8: 'type', 12: 'think', 16: 'happy',
             20: 'sleep', 24: 'sit', 26: 'climb', 30: 'ascend', 31: 'fall'}
    cols, rows = 8, 4
    cw, ch = 128 + 8, 128 + 22
    sheet = Image.new('RGBA', (cols * cw, rows * ch), (128, 128, 128, 255))
    d = ImageDraw.Draw(sheet)
    state = ''
    for i, im in enumerate(images):
        state = names.get(i, state)
        x, y = (i % cols) * cw, (i // cols) * ch
        d.rectangle([x + 4, y + 4, x + 4 + 127, y + 4 + 127], fill=(150, 150, 150, 255))
        sheet.alpha_composite(im, (x + 4, y + 4))
        d.text((x + 6, y + 134), "%d %s" % (i, state), fill=(255, 255, 255, 255))
    return sheet


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--preview', metavar='PATH')
    args = ap.parse_args()
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = os.path.join(root, 'src', 'images', 'Claude')
    os.makedirs(out, exist_ok=True)
    frames = build_frames()
    images = [f.image() for f in frames]
    for i, im in enumerate(images):
        im.save(os.path.join(out, '%d.png' % i))
    if args.preview:
        contact_sheet(images).save(args.preview)
    return 0


if __name__ == '__main__':
    sys.exit(main())
