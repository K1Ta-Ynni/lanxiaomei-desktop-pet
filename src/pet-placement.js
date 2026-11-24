import { bottomRightPosition, keepWindowReachable } from './geometry.js';

const overlayRoom = 266;
const screenEdgeMargin = 12;

// All values are Electron DIP, never physical pixels. Window sizes are owned by
// the application: feeding getBounds() sizes back into a transparent Windows
// window can accumulate DPI rounding errors on every move (Electron 39).
export class PetPlacement {
  constructor(window, screen, bounds, onLift = () => {}) {
    this.window = window;
    this.screen = screen;
    this.bounds = { ...bounds };
    this.nativeBounds = { ...bounds };
    this.topInset = 0;
    this.bottomInset = 0;
    this.lift = 0;
    this.onLift = onLift;
    this.drag = null;
    this.corrections = 0;
    window.on('resize', () => this.scheduleRepair());
    window.once('closed', () => clearImmediate(this.repair));
  }

  apply() {
    const bounds = this.nativeBounds;
    const actual = this.window.getBounds();
    // Pointer events can arrive without cursor movement. Do not touch the HWND
    // in that case, including the harmless one-DIP physical-pixel rounding.
    if (actual.x === bounds.x && actual.y === bounds.y &&
        Math.abs(actual.width - bounds.width) <= 1 && Math.abs(actual.height - bounds.height) <= 1) return;
    this.window.setBounds({ ...bounds }, false);
  }

  place(position, size = this.bounds, area) {
    this.corrections = 0;
    const minY = area && this.topInset ? area.y - this.topInset : -Infinity;
    const nativeBottomY = area ? Math.max(area.y, area.y + area.height - size.height) : Infinity;
    const maxY = area && this.bottomInset ? nativeBottomY + this.bottomInset : Infinity;
    this.bounds = { x: Math.round(position.x), y: Math.round(Math.max(minY, Math.min(maxY, position.y))), width: size.width, height: size.height };
    const lift = area && this.topInset && this.bounds.y < area.y ? area.y - this.bounds.y :
      area && this.bottomInset ? Math.min(0, nativeBottomY - this.bounds.y) : 0;
    this.nativeBounds = { ...this.bounds };
    this.nativeBounds.y += lift;
    if (lift > 0 && !this.drag?.moved) {
      // Keep the HWND on this display and use its lower space for the overlays.
      this.nativeBounds.height = Math.max(size.height, Math.min(area.height, size.height + overlayRoom));
    }
    this.apply();
    if (lift !== this.lift) {
      this.lift = lift;
      this.onLift(lift);
    }
  }

  setArtworkInsets(top, bottom) {
    const topInset = Math.max(0, Math.round(top) - screenEdgeMargin);
    const bottomInset = Math.max(0, Math.round(bottom) - screenEdgeMargin);
    if (this.topInset === topInset && this.bottomInset === bottomInset) return;
    this.topInset = topInset;
    this.bottomInset = bottomInset;
    if (!this.drag) this.displaysChanged();
  }

  scheduleRepair() {
    clearImmediate(this.repair);
    this.repair = setImmediate(() => {
      if (this.window.isDestroyed() || this.corrections >= 2) return;
      const actual = this.window.getBounds();
      if (Math.abs(actual.width - this.nativeBounds.width) <= 1 && Math.abs(actual.height - this.nativeBounds.height) <= 1) return;
      // Windows may apply WM_DPICHANGED after setBounds returns. Restore the
      // intended size, but bound retries so a platform constraint cannot loop.
      ++this.corrections;
      this.apply();
    });
  }

  reset() {
    this.cancelDrag();
    this.place(bottomRightPosition(this.screen.getPrimaryDisplay().workArea, this.bounds));
  }

  moveTo(x, y) {
    this.cancelDrag();
    const area = this.screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) }).workArea;
    this.place(keepWindowReachable(x, y, this.bounds, area, this.topInset, this.bottomInset), this.bounds, area);
  }

  resize(size) {
    this.cancelDrag();
    const position = { x: this.bounds.x, y: this.bounds.y + this.bounds.height - size.height };
    const area = this.screen.getDisplayMatching(this.nativeBounds).workArea;
    this.place(keepWindowReachable(position.x, position.y, size, area, this.topInset, this.bottomInset), size, area);
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
    const area = this.topInset || this.bottomInset ? this.screen.getDisplayNearestPoint(cursor).workArea : undefined;
    this.place({ x: this.drag.origin.x + dx, y: this.drag.origin.y + dy }, this.bounds, area);
  }

  endDrag() {
    if (this.drag?.moved) {
      this.moveDrag();
      const area = this.screen.getDisplayNearestPoint(this.screen.getCursorScreenPoint()).workArea;
      this.cancelDrag();
      this.place(keepWindowReachable(this.bounds.x, this.bounds.y, this.bounds, area, this.topInset, this.bottomInset), this.bounds, area);
      return;
    }
    this.cancelDrag();
  }

  cancelDrag() { this.drag = null; }

  displaysChanged() {
    if (this.drag) return;
    const area = this.screen.getDisplayMatching(this.nativeBounds).workArea;
    this.place(keepWindowReachable(this.bounds.x, this.bounds.y, this.bounds, area, this.topInset, this.bottomInset), this.bounds, area);
  }
}
