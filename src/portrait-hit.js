const masks = new Map();

function opacityMask(image) {
  const source = image.currentSrc;
  if (masks.has(source)) return masks.get(source);
  const { naturalWidth: width, naturalHeight: height } = image;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  try {
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, width, height);
    const mask = new Uint8Array(Math.ceil(width * height / 8));
    for (let pixel = 0; pixel < width * height; pixel++) {
      if (data[pixel * 4 + 3] >= 32) mask[pixel >> 3] |= 1 << (pixel & 7);
    }
    if (masks.size >= 24) masks.delete(masks.keys().next().value);
    masks.set(source, mask);
    return mask;
  } catch {
    // Keep custom images usable if Chromium restricts canvas access.
    masks.set(source, null);
    return null;
  }
}

export function hitsPortrait(image, clientX, clientY) {
  const { naturalWidth, naturalHeight, clientWidth, clientHeight } = image;
  if (!image.complete || !naturalWidth || !naturalHeight || !clientWidth || !clientHeight) return false;
  const parent = image.parentElement.getBoundingClientRect();
  let x = clientX - parent.left - image.offsetLeft;
  let y = clientY - parent.top - image.offsetTop;
  const style = getComputedStyle(image);
  if (style.transform !== 'none') {
    const [originX, originY] = style.transformOrigin.split(' ').map(parseFloat);
    const inverse = new DOMMatrix(style.transform).inverse();
    const point = inverse.transformPoint(new DOMPoint(x - originX, y - originY));
    x = point.x + originX;
    y = point.y + originY;
  }
  // Keep pointer coordinates in the same object-fit: contain box as the image.
  const scale = Math.min(clientWidth / naturalWidth, clientHeight / naturalHeight);
  const column = Math.floor((x - (clientWidth - naturalWidth * scale) / 2) / scale);
  const row = Math.floor((y - (clientHeight - naturalHeight * scale) / 2) / scale);
  if (column < 0 || column >= naturalWidth || row < 0 || row >= naturalHeight) return false;
  const mask = opacityMask(image);
  if (!mask) return true;
  const pixel = row * naturalWidth + column;
  return (mask[pixel >> 3] & (1 << (pixel & 7))) !== 0;
}
