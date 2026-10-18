/** Cursor shaped like the comment pin (a circle with a square bottom-left corner); the hotspot is that corner. */
const COMMENT_CURSOR_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><path d="M3 33V19a15 15 0 1 1 15 15H3z" fill="#6b4ce6" stroke="white" stroke-width="2.5" stroke-linejoin="round"/></svg>';
export const COMMENT_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(COMMENT_CURSOR_SVG)}") 3 33, crosshair`;
