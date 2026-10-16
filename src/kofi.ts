import qr from '../assets/kofi-qr.svg';

const KOFI_URL = 'https://ko-fi.com/huuuda';

/** Ko-fi donation QR in the bottom-right corner (menu screens only; the in-game corner belongs to the HUD). The code is generated from KOFI_URL as assets/kofi-qr.svg. */
export function createKofi(frame: HTMLElement) {
  const a = document.createElement('a'); a.id = 'kofi'; a.href = KOFI_URL; a.target = '_blank'; a.rel = 'noopener'; a.title = 'Support the game on Ko-fi'; a.hidden = true;
  a.innerHTML = `<img src="${qr}" alt="QR code for ${KOFI_URL}" width="96" height="96"><small>Enjoying this remake?<br>Help me make more!</small>`;
  frame.append(a);
  return { show: () => { a.hidden = false; }, hide: () => { a.hidden = true; } };
}
