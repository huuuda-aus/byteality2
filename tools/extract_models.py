"""Parse ByteAlity line-list model definitions (GML) into assets/models.json.
Segments are flat [x1,y1,x2,y2,...] in px, y down, origin = object centre, angle 0 = +x."""
import re, json, sys
D = 'reference/decompiled/scripts/'
def strip(s):
    s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
    return re.sub(r'//[^\n]*', '', s)
def parse(src, key_re):
    models = {}
    for line in strip(src).splitlines():
        line = line.strip()
        m = re.match(r'global\.(\w+)(?:\[(\w+)\])?\s*=\s*d3d_model_create', line)
        if m: continue
        m = re.match(r'd3d_model_segments\((\d+),\s*global\.(\w+)(?:\[(\w+)\])?,\s*(.*)\)$', line)
        if m:
            n = int(m.group(1)); k = m.group(3) or m.group(2)
            v = [float(x) for x in m.group(4).split(',')]
            if len(v) < 2*(n+1):  # GM pads missing arguments with 0 (original quirk, kept)
                print('pad', k, file=sys.stderr); v += [0.0]*(2*(n+1)-len(v))
            for i in range(n):
                models.setdefault(k, []).extend(v[2*i:2*i+4])
            continue
        m = re.match(r'd3d_model_segment\(\s*global\.(\w+)(?:\[(\w+)\])?,\s*(.*)\)$', line)
        if m:
            k = m.group(2) or m.group(1)
            v = [float(x) for x in m.group(3).split(',')]
            assert len(v) == 4, line
            models.setdefault(k, []).extend(v)
    return models
consts = dict(re.findall(r"\['(\w+)', '(\d+)'\]", open('/dev/null').read()))
towers = parse(open(D+'tower_declare_models.gml', encoding='latin-1').read(), None)
bullets = parse(open(D+'bullet_declare_models.gml', encoding='latin-1').read(), None)
# enemies: ported from enemy_declare_models.gml (loop with per-type flags)
def circ(r):
    s = []
    h = {6: [(6,0),(5,-3),(3,-5),(0,-6),(-3,-5),(-5,-3),(-6,0)], 4: [(4,0),(3,-2),(2,-3),(0,-4),(-2,-3),(-3,-2),(-4,0)],
         8: [(8,0),(7,-4),(4,-7),(0,-8),(-4,-7),(-7,-4),(-8,0)]}[r]
    for a, b in zip(h, h[1:]): s += [*a, *b]
    for a, b in zip(h, h[1:]): s += [a[0], -a[1], b[0], -b[1]]
    return s
names = ['Normal','Many','Fast','Weak','Strong','Slow','Few','Super','Bonus','Boss']
enemies = {}
for e, n in enumerate(names):
    s = []
    if n == 'Boss':
        s += circ(8)
        for pts in ([5,3,6,-2,3,1,3,-3,1,1,0,-4,-1,1], [-1,1,-3,-3,-3,1,-6,-2,-5,3,5,3]):
            for i in range(0, len(pts)-2, 2): s += pts[i:i+4]
    else:
        s += circ(6)
        if n in ('Strong','Slow','Few'): s += circ(4)
        if n in ('Fast','Weak','Few'): s += [4,0,-3,-3, -3,-3,-3,3, -3,3,4,0]
        if n in ('Many','Weak','Slow'): s += [4,0,-4,0, 0,-4,0,0, 0,4,0,0]
        if n == 'Super': s += [4,1,-1,1, 4,-1,1,-1, -4,1,-1,1, -4,-1,1,-1, 1,4,1,1, -1,4,-1,-1, 1,-4,1,1, -1,-4,-1,-1]
        if n == 'Bonus':
            for pts in ([1,-3,0,-4,-1,-4,-2,-3,-2,-2],[-2,-2,-1,-1,0,-1,1,-2,1,-3],[4,0,3,-1,2,-1,1,0,1,1],[1,1,2,2,3,2,4,1,4,0],[0,1,-1,0,-2,0,-3,1,-3,2],[-3,2,-2,3,-1,3,0,2,0,1]):
                for i in range(0, len(pts)-2, 2): s += pts[i:i+4]
    enemies[n.lower()] = [float(x) for x in s]
out = dict(towers=towers, bullets=bullets, enemies=enemies)
json.dump(out, open('assets/models.json', 'w'), separators=(',', ':'))
for k, v in out.items(): print(k, len(v), {a: len(b)//4 for a, b in list(v.items())[:40]})
