import { bottomRightPosition, keepWindowReachable } from './geometry.js';

// All values are Electron DIP, never physical pixels. Window sizes are owned by
// the application: feeding getBounds() sizes back into a transparent Windows
// window can accumulate DPI rounding errors on every move (Electron 39).
export class PetPlacement {
  constructor(window, screen, bounds) {
    this.window = window;
    this.screen = screen;
    this.bounds = { ...bounds };
    this.drag = null;
    this.corrections = 0;
    window.on('resize', () => this.scheduleRepair());
    window.once('closed', () => clearImmediate(this.repair));
  }

  apply(bounds) {
    this.bounds = { ...bounds, x: Math.round(bounds.x), y: Math.round(bounds.y) };
    const actual = this.window.getBounds();
    // Pointer events can arrive without cursor movement. Do not touch the HWND
    // in that case, including the harmless one-DIP physical-pixel rounding.
    if (actual.x === this.bounds.x && actual.y === this.bounds.y &&
        Math.abs(actual.width - this.bounds.width) <= 1 && Math.abs(actual.height - this.bounds.height) <= 1) return;
    this.window.setBounds({ ...this.bounds }, false);
  }

  place(position, size = this.bounds) {
    this.corrections = 0;
    this.apply({ x: position.x, y: position.y, width: size.width, height: size.height });
  }

  scheduleRepair() {
    clearImmediate(this.repair);
    this.repair = setImmediate(() => {
      if (this.window.isDestroyed() || this.corrections >= 2) return;
      const actual = this.window.getBounds();
      if (Math.abs(actual.width - this.bounds.width) <= 1 && Math.abs(actual.height - this.bounds.height) <= 1) return;
      // Windows may apply WM_DPICHANGED after setBounds returns. Restore the
      // intended size, but bound retries so a platform constraint cannot loop.
      ++this.corrections;
      this.apply(this.bounds);
    });
  }

  reset() {
    this.cancelDrag();
    this.place(bottomRightPosition(this.screen.getPrimaryDisplay().workArea, this.bounds));
  }

  moveTo(x, y) {
    this.cancelDrag();
    const area = this.screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) }).workArea;
    this.place(keepWindowReachable(x, y, this.bounds, area));
  }

  resize(size) {
    this.cancelDrag();
    const position = { x: this.bounds.x, y: this.bounds.y + this.bounds.height - size.height };
    const area = this.screen.getDisplayMatching(this.bounds).workArea;
    this.place(keepWindowReachable(position.x, position.y, size, area), size);
  }

  startDrag() {
    this.drag = { cursor: this.screen.getCursorScreenPoint(), origin: { ...this.bounds }, moved: false };
  }

  moveDrag() {
    if (!this.drag) return;
    const cursor = this.screen.getCursorScreenPoint();
    const dx = cursor.x - this.drag.cursor.x, dy = cursor.y - this.drag.cursor.y;
    if (!this.drag.moved && dx === 0 && dy === 0) return;
    this.drag.moved = true;
    // Absolute native cursor position avoids renderer movementX scaling and
    // feedback from the moving window. Allow crossing monitor edges while held.
    this.place({ x: this.drag.origin.x + dx, y: this.drag.origin.y + dy });
  }

  endDrag() {
    if (this.drag?.moved) {
      this.moveDrag();
      const area = this.screen.getDisplayNearestPoint(this.screen.getCursorScreenPoint()).workArea;
      this.place(keepWindowReachable(this.bounds.x, this.bounds.y, this.bounds, area));
    }
    this.cancelDrag();
  }

  cancelDrag() { this.drag = null; }

  displaysChanged() {
    if (this.drag) return;
    const area = this.screen.getDisplayMatching(this.bounds).workArea;
    this.place(keepWindowReachable(this.bounds.x, this.bounds.y, this.bounds, area));
  }
}
