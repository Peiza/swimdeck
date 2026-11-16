// Drag to reorder the swimmer cards (mouse, touch and arrow keys).
// Called once from app.js with what it needs, so this file has no state of its own.

export function initReorder({ state, save }) {
  const deck = () => document.querySelector('#deck');

  let drag = null;

  function finishReorder() {
    const order = [...deck().children].map((li) => Number(li.dataset.open));
    state.swimmers.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    save();
  }

  document.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('[data-drag]');
    if (!handle || e.button > 0) return;
    e.preventDefault();
    const card = handle.closest('.card');
    drag = { card, pointer: e.pointerId };
    card.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);
  });

  document.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    if (e.clientY < 70) window.scrollBy(0, -14);
    else if (e.clientY > innerHeight - 70) window.scrollBy(0, 14);
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('#deck > .card');
    if (!over || over === drag.card) return;
    const items = [...over.parentElement.children];
    const before = items.indexOf(drag.card) > items.indexOf(over);
    over.parentElement.insertBefore(drag.card, before ? over : over.nextSibling);
  });

  function endDrag(e) {
    if (!drag || e.pointerId !== drag.pointer) return;
    drag.card.classList.remove('dragging');
    drag = null;
    finishReorder();
  }
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);

  // Keyboard: arrow keys on the handle move the card.
  document.addEventListener('keydown', (e) => {
    const handle = e.target.closest?.('[data-drag]');
    if (!handle || !['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const card = handle.closest('.card');
    const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
    const sib = back ? card.previousElementSibling : card.nextElementSibling;
    if (!sib) return;
    card.parentElement.insertBefore(card, back ? sib : sib.nextSibling);
    finishReorder();
    handle.focus();
  });
}
