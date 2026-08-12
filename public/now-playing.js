import { api } from './api.js';

const el = document.getElementById('now-playing');
const textEl = document.getElementById('now-playing-text');

export async function pollNowPlaying() {
  try {
    const res = await api('/media/now-playing');
    if (!res.ok || !res.playing || !res.title) {
      el.classList.remove('active');
      return;
    }
    textEl.textContent = res.artist ? `${res.title} — ${res.artist}` : res.title;
    el.classList.add('active');
  } catch {
    el.classList.remove('active');
  }
}
