import subprocess, time, struct
from PIL import Image
def snap(path):
    d = open('fb/Xvfb_screen0','rb').read()
    hs, ver, fmt, depth, w, h = struct.unpack('>6I', d[:24]); bpl = struct.unpack('>I', d[48:52])[0]; ncol = struct.unpack('>I', d[76:80])[0]
    off = hs + ncol * 12
    Image.frombuffer('RGB', (w, h), d[off:off + bpl * h], 'raw', 'BGRX', bpl, 1).save(path)
act = lambda *a: subprocess.run(['../venv/bin/python', 'act.py', *map(str, a)], check=True)
act('click', 400, 275, 'sleep', 1.5, 'click', 235, 100, 'sleep', 1.5, 'click', 124, 100, 'sleep', 1.5)
act('click', 190, 122, 'sleep', 1, 'click', 376, 112, 'sleep', 1, 'click', 487, 283, 'sleep', 2)
act('click', 230, 96, 'sleep', 0.4, 'click', 400, 250, 'sleep', 0.4)   # gun tower between the two horizontal path segments
snap('q0.png')
act('move', 400, 228, 'key', 'space')
t0 = time.time(); i = 0
while time.time() - t0 < 30:
    snap(f'f{i:03d}.png'); i += 1; time.sleep(0.12)
print('frames', i)
