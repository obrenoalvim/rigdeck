import { api } from './api.js';
import { showToast } from './toast.js';

export function wireMediaBar() {
  document.querySelectorAll('.media-btn').forEach((btn) => {
    btn.onclick = async () => {
      btn.classList.add('firing');
      setTimeout(() => btn.classList.remove('firing'), 150);
      try {
        await api(`/media/${btn.dataset.action}`, { method: 'POST' });
      } catch (e) {
        showToast(`Erro: ${e.message}`, false);
      }
    };
  });
}
