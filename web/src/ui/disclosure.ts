// A small disclosure popover: a button with aria-expanded that shows a panel (the "Key" to
// the marks). Escape closes it and keeps focus on the button; a click outside or moving
// focus elsewhere closes it too. The panel is positioned by CSS next to the button.

export interface Disclosure {
  close(): void;
}

export function setupDisclosure(button: HTMLButtonElement, panel: HTMLElement): Disclosure {
  const isOpen = () => button.getAttribute('aria-expanded') === 'true';
  const inside = (node: EventTarget | null) =>
    node instanceof Node && (panel.contains(node) || button.contains(node));

  function onPointerDown(e: PointerEvent): void {
    if (!inside(e.target)) close();
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || e.isComposing) return;
    const hadFocus = inside(document.activeElement);
    close();
    if (hadFocus) button.focus();
  }

  function listen(on: boolean): void {
    if (on) {
      document.addEventListener('pointerdown', onPointerDown, true);
      document.addEventListener('keydown', onKeyDown);
    } else {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    }
  }

  function open(): void {
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    listen(true);
  }

  function close(): void {
    if (!isOpen()) return;
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    listen(false);
  }

  button.addEventListener('click', () => (isOpen() ? close() : open()));
  for (const el of [button, panel]) {
    el.addEventListener('focusout', (e) => {
      // null: focus went nowhere (e.g. a click on the panel's text); pointerdown handles clicks.
      if (e.relatedTarget instanceof Node && !inside(e.relatedTarget)) close();
    });
  }

  return { close };
}
