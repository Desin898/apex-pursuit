// Menu — a small data-driven list menu (pause, settings, controls) that works identically with
// keyboard, mouse and controller (D-pad or stick to move, ✕/A to choose, ○/B to go back).
import { Actions, DeviceKind, glyph } from '../input/InputManager';

export interface MenuItem {
  label: string;
  /** current value shown on the right */
  value?: () => string;
  /** ✕ / Enter / click */
  accept?: () => void;
  /** left (−1) / right (+1) for sliders and choices */
  adjust?: (dir: number) => void;
}
export interface MenuPage {
  title: string;
  eyebrow: string;
  items: MenuItem[];
  /** optional extra HTML rendered under the list (the controls table) */
  extra?: () => string;
  /** wire up anything interactive inside `extra` after it is rendered */
  bind?: (root: HTMLElement) => void;
}

export class Menu {
  private root = document.getElementById('pause')!;
  private list = document.getElementById('pause-list')!;
  private titleEl = document.getElementById('pause-title')!;
  private foot = document.getElementById('pause-foot')!;
  private stack: { page: MenuPage; index: number }[] = [];
  private device: DeviceKind = 'keyboard';
  onSound: (kind: 'move' | 'accept' | 'back') => void = () => {};
  /** called when ○/Esc is pressed on the root page */
  onClose: () => void = () => {};

  get isOpen(): boolean {
    return this.stack.length > 0;
  }

  open(page: MenuPage): void {
    this.stack = [{ page, index: 0 }];
    this.root.hidden = false;
    this.render();
  }
  push(page: MenuPage): void {
    this.stack.push({ page, index: 0 });
    this.render();
  }
  close(): void {
    this.stack = [];
    this.root.hidden = true;
  }
  setDevice(kind: DeviceKind): void {
    if (kind !== this.device) {
      this.device = kind;
      if (this.isOpen) this.render();
    }
  }

  goBack(): void {
    this.back();
  }

  private back(): void {
    this.onSound('back');
    if (this.stack.length > 1) {
      this.stack.pop();
      this.render();
    } else this.onClose();
  }

  /** Feed one frame of input while the menu is open. */
  handle(a: Actions): void {
    if (!this.isOpen) return;
    const top = this.stack[this.stack.length - 1];
    const n = top.page.items.length;
    if (a.up) {
      top.index = (top.index - 1 + n) % n;
      this.onSound('move');
      this.render();
    } else if (a.down) {
      top.index = (top.index + 1) % n;
      this.onSound('move');
      this.render();
    }
    const item = top.page.items[top.index];
    if (item) {
      if ((a.left || a.right) && item.adjust) {
        item.adjust(a.right ? 1 : -1);
        this.onSound('move');
        this.render();
      } else if (a.accept) {
        if (item.accept) {
          this.onSound('accept');
          item.accept();
        } else if (item.adjust) {
          item.adjust(1);
          this.onSound('move');
        }
        if (this.isOpen) this.render();
      }
    }
    if (a.back || a.pause) this.back();
  }

  render(): void {
    if (!this.isOpen) return;
    if (document.activeElement && document.activeElement.tagName === 'INPUT' && this.root.contains(document.activeElement)) return; // mid-typing
    const top = this.stack[this.stack.length - 1];
    this.titleEl.innerHTML = `<small>${top.page.eyebrow}</small>${top.page.title}`;
    this.list.innerHTML = '';
    top.page.items.forEach((item, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'item' + (i === top.index ? ' sel' : '');
      b.id = `menu-item-${i}`;
      const v = item.value ? item.value() : '';
      b.innerHTML = `<span>${item.label}</span><span class="val">${item.adjust ? '<em>‹</em>' : ''}${v}${item.adjust ? '<em>›</em>' : item.accept && !item.value ? '<em>›</em>' : ''}</span>`;
      b.addEventListener('click', (e) => {
        top.index = i;
        if (item.adjust) {
          // clicking the left half of the value steps down; anywhere else steps up
          const r = b.querySelector('.val')!.getBoundingClientRect();
          item.adjust(e.clientX >= r.left && e.clientX < r.left + r.width / 2 ? -1 : 1);
          this.onSound('move');
        } else if (item.accept) {
          this.onSound('accept');
          item.accept();
        }
        if (this.isOpen) this.render();
      });
      b.addEventListener('mouseenter', () => {
        if (top.index !== i) {
          top.index = i;
          this.list.querySelectorAll('.item').forEach((el, k) => el.classList.toggle('sel', k === i));
        }
      });
      this.list.appendChild(b);
    });
    if (top.page.extra) {
      const d = document.createElement('div');
      d.innerHTML = top.page.extra();
      this.list.appendChild(d);
      top.page.bind?.(d);
    }
    this.list.querySelector('.item.sel')?.scrollIntoView({ block: 'nearest' });
    const k = this.device;
    const nav = k === 'keyboard' ? '↑ ↓' : 'D-pad';
    const adj = k === 'keyboard' ? '← →' : '◂ ▸';
    this.foot.innerHTML = `<span><kbd>${nav}</kbd> Move</span><span><kbd>${adj}</kbd> Change</span><span><kbd>${glyph(k, 'accept')}</kbd> Select</span><span><kbd>${glyph(k, 'back')}</kbd> Back</span>`;
  }
}
