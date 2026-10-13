import sys, time
from Xlib import X, display, XK
from Xlib.ext import xtest
d = display.Display(':99')
def move(x, y): xtest.fake_input(d, X.MotionNotify, x=x, y=y); d.sync()
def click(x, y, button=1, hold=0.08):
    move(x, y); time.sleep(0.15)
    xtest.fake_input(d, X.ButtonPress, button); d.sync(); time.sleep(hold)
    xtest.fake_input(d, X.ButtonRelease, button); d.sync()
def key(name):
    ks = XK.string_to_keysym(name); kc = d.keysym_to_keycode(ks)
    xtest.fake_input(d, X.KeyPress, kc); d.sync(); time.sleep(0.05)
    xtest.fake_input(d, X.KeyRelease, kc); d.sync(); time.sleep(0.05)
def typ(s):
    for ch in s: key({' ': 'space'}.get(ch, ch))
args = sys.argv[1:]
i = 0
while i < len(args):
    a = args[i]
    if a == 'click': click(int(args[i+1]), int(args[i+2])); i += 3
    elif a == 'rclick': click(int(args[i+1]), int(args[i+2]), 3); i += 3
    elif a == 'move': move(int(args[i+1]), int(args[i+2])); i += 3
    elif a == 'type': typ(args[i+1]); i += 2
    elif a == 'key': key(args[i+1]); i += 2
    elif a == 'sleep': time.sleep(float(args[i+1])); i += 2
    else: raise SystemExit('bad ' + a)
