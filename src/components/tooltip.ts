import type { CSSProperties } from "react";

/** Place a tooltip next to the pointer, flipping it so it stays on screen. */
export function tooltipPosition(x: number, y: number): CSSProperties {
  const style: CSSProperties = {};
  if (x > window.innerWidth - 480) style.right = window.innerWidth - x + 14;
  else style.left = x + 14;
  if (y > window.innerHeight - 260) style.bottom = window.innerHeight - y + 14;
  else style.top = y + 14;
  return style;
}
