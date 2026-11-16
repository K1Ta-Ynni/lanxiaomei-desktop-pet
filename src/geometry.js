export function bottomRightPosition(area, windowSize, right = 30, bottom = 20) {
  return {
    x: Math.max(area.x, area.x + area.width - windowSize.width - right),
    y: Math.max(area.y, area.y + area.height - windowSize.height - bottom),
  };
}

export function petWindowSize(portrait) {
  return { width: Math.max(210, portrait.width + 26), height: portrait.height + 212 };
}

export function keepWindowReachable(x, y, windowSize, area) {
  const maxX = Math.max(area.x, area.x + area.width - windowSize.width);
  const maxY = Math.max(area.y, area.y + area.height - windowSize.height);
  return {
    x: Math.round(Math.max(area.x, Math.min(maxX, x))),
    y: Math.round(Math.max(area.y, Math.min(maxY, y))),
  };
}
