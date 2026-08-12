const toast = document.getElementById('toast');
let hideTimer = null;

export function showToast(text, ok = true) {
  clearTimeout(hideTimer);
  toast.innerHTML = '';
  toast.textContent = text;
  toast.className = ok ? '' : 'fail';
  toast.style.display = 'block';
  hideTimer = setTimeout(() => (toast.style.display = 'none'), 4000);
}

// Toast com botao de acao (ex: "desfazer apagar") -- fica visivel por
// `duration` antes de sumir sozinho; clicar na acao chama onAction na hora.
export function showActionToast(text, actionLabel, onAction, duration = 6000) {
  clearTimeout(hideTimer);
  toast.innerHTML = '';
  toast.className = 'action';
  const span = document.createElement('span');
  span.textContent = text;
  const btn = document.createElement('button');
  btn.className = 'toast-action';
  btn.textContent = actionLabel;
  btn.onclick = () => {
    clearTimeout(hideTimer);
    toast.style.display = 'none';
    onAction();
  };
  toast.append(span, btn);
  toast.style.display = 'flex';
  hideTimer = setTimeout(() => (toast.style.display = 'none'), duration);
}
