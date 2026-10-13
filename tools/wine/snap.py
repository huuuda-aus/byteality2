import struct, sys
from PIL import Image
d = open('fb/Xvfb_screen0','rb').read()
hs, ver, fmt, depth, w, h = struct.unpack('>6I', d[:24])
bpp = struct.unpack('>I', d[44:48])[0]; bpl = struct.unpack('>I', d[48:52])[0]; ncol = struct.unpack('>I', d[76:80])[0]
off = hs + ncol * 12
img = Image.frombuffer('RGB', (w, h), d[off:off + bpl * h], 'raw', 'BGRX', bpl, 1)
img.save(sys.argv[1]); print(w, h, bpp)
