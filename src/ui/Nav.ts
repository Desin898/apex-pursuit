// ─────────────────────────────────────────────────────────────────────────────
// Nav — spatial focus for menu pages, so every page works the same with a mouse, the
// keyboard and a DualShock 4.
//
// Any visible element marked [data-nav] inside the page root can take focus. Arrow keys,
// the D-pad or the left stick move focus to the nearest element in that direction; Cross /
// Enter clicks it; Circle / Esc presses the page's [data-back] element (or calls onBack).
// Hovering with the mouse moves focus too, so the highlight never disagrees with the pointer.
// ─────────────────────────────────────────────────────────────────────────────
import { Actions } from '../input/InputManager';

type Dir = 'up' | 'down' | 'left' | 'right';

export class Nav {
  focused: HTMLElement | null = null;
  onMove: () => void = () => {};
  onBack: (() => void) | null = null;
  /** optional handlers for L1 / R1 (carousels) */
  onPrev: (() => void) | null = null;
  onNext: (() => void) | null = null;

  constructor(readonly root: HTMLElement) {
    root.addEventListener('pointerover', (e) => {
      const el = (e.target as HTMLElement).closest('[data-nav]') as HTMLElement | null;
      if (el && root.contains(el) && el !== this.focused) this.focus(el, false);
    });
  }

  items(): HTMLElement[] {
    return Array.from(this.root.querySelectorAll<HTMLElement>('[data-nav]')).filter((el) => {
      if (el.getAttribute('aria-disabled') === 'true' && !el.hasAttribute('data-nav-disabled-ok')) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    });
  }

  focus(el: HTMLElement | null, sound = true): void {
    if (this.focused === el) return;
    this.focused?.classList.remove('focus');
    this.focused = el;
    if (el) {
      el.classList.add('focus');
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      if (sound) this.onMove();
    }
  }

  /** Focus the first element (or a specific one) when the page opens. */
  reset(prefer?: HTMLElement | null): void {
    const list = this.items();
    this.focused?.classList.remove('focus');
    this.focused = null;
    this.focus(prefer && list.includes(prefer) ? prefer : list[0] ?? null, false);
  }

  private move(dir: Dir): void {
    const list = this.items();
    if (!list.length) return;
    if (!this.focused || !list.includes(this.focused)) {
      this.focus(list[0]);
      return;
    }
    const a = this.focused.getBoundingClientRect();
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const el of list) {
      if (el === this.focused) continue;
      const b = el.getBoundingClientRect();
      const bx = b.left + b.width / 2;
      const by = b.top + b.height / 2;
      const dx = bx - ax;
      const dy = by - ay;
      let main: number;
      let cross: number;
      if (dir === 'up') {
        if (b.bottom > a.top + 2 && by >= ay - 2) continue;
        main = -dy;
        cross = Math.abs(dx);
      } else if (dir === 'down') {
        if (b.top < a.bottom - 2 && by <= ay + 2) continue;
        main = dy;
        cross = Math.abs(dx);
      } else if (dir === 'left') {
        if (b.right > a.left + 2 && bx >= ax - 2) continue;
        main = -dx;
        cross = Math.abs(dy);
      } else {
        if (b.left < a.right - 2 && bx <= ax + 2) continue;
        main = dx;
        cross = Math.abs(dy);
      }
      if (main <= 0) continue;
      const score = main + cross * 2.2;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (best) this.focus(best);
  }

  /** Feed one frame of input. Returns true if it used the input. */
  handle(a: Actions): boolean {
    const typing = document.activeElement && (document.activeElement as HTMLElement).tagName === 'INPUT' && this.root.contains(document.activeElement);
    if (typing) return false;
    let used = false;
    if (a.up) (this.move('up'), (used = true));
    if (a.down) (this.move('down'), (used = true));
    if (a.left) {
      if (this.focused?.dataset.adjust !== undefined) this.focused.dispatchEvent(new CustomEvent('adjust', { detail: -1 }));
      else this.move('left');
      used = true;
    }
    if (a.right) {
      if (this.focused?.dataset.adjust !== undefined) this.focused.dispatchEvent(new CustomEvent('adjust', { detail: 1 }));
      else this.move('right');
      used = true;
    }
    if (a.shiftDown && this.onPrev) (this.onPrev(), (used = true));
    if (a.shiftUp && this.onNext) (this.onNext(), (used = true));
    if (a.accept && this.focused) {
      const input = this.focused.matches('input') ? this.focused : (this.focused.querySelector('input') as HTMLElement | null);
      if (input) input.click();
      else this.focused.click();
      used = true;
    }
    if (a.back || a.pause) {
      const back = this.root.querySelector<HTMLElement>('[data-back]');
      if (this.onBack) this.onBack();
      else back?.click();
      used = true;
    }
    return used;
  }
}
