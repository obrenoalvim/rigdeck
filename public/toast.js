const toast = document.getElementById('toast');

export function showToast(text, ok = true) {
  toast.textContent = text;
  toast.className = ok ? '' : 'fail';
  toast.style.display = 'block';
  setTimeout(() => (toast.style.display = 'none'), 4000);
}
