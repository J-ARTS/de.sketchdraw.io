export type ToolIconName =
  | 'select' | 'hand' | 'rectangle' | 'ellipse' | 'diamond'
  | 'connector' | 'path' | 'eraser' | 'text' | 'sticky-note' | 'annotation' | 'table' | 'image' | 'container' | 'web-embed' | 'frame' | 'comment' | 'laser';

export type ActionIconName =
  | 'component' | 'undo' | 'redo' | 'plus' | 'minus' | 'fit-all' | 'fit-selection'
  | 'file' | 'file-plus' | 'folder-open' | 'save' | 'save-as' | 'help' | 'sun' | 'moon'
  | 'arrow-up' | 'chevron-up' | 'chevron-down' | 'chevron-left' | 'chevron-right' | 'close' | 'check'
  | 'warning' | 'info' | 'dot' | 'saving' | 'download'
  | 'group' | 'ungroup' | 'connect' | 'duplicate' | 'trash'
  | 'order-front' | 'order-forward' | 'order-backward' | 'order-back'
  | 'objects' | 'align-left' | 'align-center' | 'align-right' | 'eye'
  | 'settings' | 'globe' | 'menu' | 'users' | 'user' | 'code' | 'maximize'
  | 'more-vertical' | 'calendar'
  | 'pages' | 'grip' | 'more' | 'copy' | 'paste' | 'rename' | 'arrow'
  | 'shapes' | 'stroke' | 'link'
  | 'eyedropper' | 'line-solid' | 'line-dashed' | 'line-animated' | 'none' | 'search';

export type IconName = ToolIconName | ActionIconName;

/** 24x24 grid, drawn as 1.75 px round-capped strokes in currentColor. */
export const ICON_PATHS: Readonly<Record<IconName, readonly string[]>> = {
  // Classic mouse pointer with tail (#94).
  select: ['M5.5 3v15.5l4.2-4 3 6.8 2.6-1.2-3-6.6h5.9z'],
  hand: [
    'M9 14V6.5a1.5 1.5 0 0 1 3 0V12',
    'M12 12V4.5a1.5 1.5 0 0 1 3 0V12',
    'M15 12V6.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-4.6-2.2L4.4 15a1.5 1.5 0 0 1 2.3-1.9L9 15.5',
  ],
  rectangle: ['M4 6h16v12H4z'],
  ellipse: ['M12 5c4.4 0 8 3.1 8 7s-3.6 7-8 7-8-3.1-8-7 3.6-7 8-7z'],
  diamond: ['M12 3l9 9-9 9-9-9z'],
  connector: ['M5 12h14', 'M13 6l6 6-6 6'],
  path: ['M4 20l1-4L16 5a2.1 2.1 0 0 1 3 3L8 19z', 'M14 7l3 3'],
  eraser: ['M4.5 14.5l8.8-8.8a2.4 2.4 0 0 1 3.4 0l1.6 1.6a2.4 2.4 0 0 1 0 3.4L9 20H5.5L3 17.5z', 'M9 20h11', 'M8 11l5 5'],
  text: ['M5 6V4h14v2', 'M12 4v16', 'M9 20h6'],
  'sticky-note': ['M5 4h14v16H5z', 'M15 20v-4h4', 'M8 8h8', 'M8 12h6'],
  annotation: ['M4 3h16v18H4z', 'M7 7h10', 'M7 11h7', 'M7 15h10', 'M7 18h6'],
  table: ['M3 4h18v16H3z', 'M3 9h18', 'M3 14h18', 'M9 4v16', 'M15 4v16'],
  image: ['M4 5h16v14H4z', 'M4 16l5-5 4 4 3-3 4 4', 'M14.5 9a1 1 0 1 0 2 0 1 1 0 1 0-2 0'],
  container: ['M3 5h18v14H3z', 'M7 10h6v5H7z'],
  frame: ['M4 4h6', 'M4 4v6', 'M20 4h-6', 'M20 4v6', 'M4 20h6', 'M4 20v-6', 'M20 20h-6', 'M20 20v-6'],
  'web-embed': ['M3 5h18v14H3z', 'M3 9h18', 'M7 7h.01', 'M10 7h.01', 'M8 14h8', 'M12 11l3 3-3 3'],
  comment: ['M4 5h16v12H9l-5 4z', 'M8 9h8', 'M8 13h5'],
  // Handheld laser pointer: pointer body emitting a straight beam onto a target spot — no wand sparkles (#95).
  laser: ['M4.87 16.87L7.13 19.13 13.13 13.13 10.87 10.87z', 'M8.47 13.27l2.26 2.26', 'M13 11l3.1-3.1', 'M15.9 6.5a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0', 'M17.5 6.5h.01'],
  component: ['M12 3l8 4.5v9L12 21l-8-4.5v-9z', 'M12 12l8-4.5', 'M12 12v9', 'M12 12L4 7.5'],
  undo: ['M9 14L4 9l5-5', 'M4 9h10a6 6 0 0 1 0 12h-3'],
  redo: ['M15 14l5-5-5-5', 'M20 9H10a6 6 0 0 0 0 12h3'],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  'fit-all': ['M4 9V5h4', 'M16 5h4v4', 'M20 15v4h-4', 'M8 19H4v-4', 'M9 9h6v6H9z'],
  'fit-selection': ['M4 9V5h4', 'M16 5h4v4', 'M20 15v4h-4', 'M8 19H4v-4', 'M12 10v4', 'M10 12h4'],
  file: ['M7 3h7l5 5v13H7z', 'M14 3v5h5'],
  'file-plus': ['M7 3h7l5 5v13H7z', 'M14 3v5h5', 'M13 12v6', 'M10 15h6'],
  'folder-open': ['M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z'],
  save: ['M5 4h12l3 3v13H5z', 'M8 4v5h7V4', 'M8 20v-6h8v6'],
  'save-as': ['M13 20H5V4h12l3 3v4', 'M8 4v5h7V4', 'M17 14v6', 'M14 17h6'],
  help: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7', 'M12 17h.01'],
  sun: [
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
    'M12 2v2', 'M12 20v2', 'M2 12h2', 'M20 12h2',
    'M4.9 4.9l1.4 1.4', 'M17.7 17.7l1.4 1.4', 'M4.9 19.1l1.4-1.4', 'M17.7 6.3l1.4-1.4',
  ],
  moon: ['M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z'],
  'arrow-up': ['M12 19V5', 'M5 12l7-7 7 7'],
  settings: ['M4 7h9', 'M17 7h3', 'M4 17h3', 'M11 17h9', 'M15 4v6', 'M9 14v6'],
  globe: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M3 12h18', 'M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z'],
  'chevron-up': ['M6 15l6-6 6 6'],
  'chevron-down': ['M6 9l6 6 6-6'],
  'chevron-left': ['M15 6l-6 6 6 6'],
  'chevron-right': ['M9 6l6 6-6 6'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  warning: ['M12 3.5l9.5 16.5h-19z', 'M12 10v4', 'M12 17h.01'],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v5', 'M12 8h.01'],
  dot: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z'],
  saving: ['M12 3a9 9 0 1 0 9 9'],
  download: ['M12 4v11', 'M7 11l5 5 5-5', 'M5 20h14'],
  group: ['M4 4h16v16H4z', 'M8 8h4v4H8z', 'M12 12h4v4h-4z'],
  ungroup: ['M4 4h7v7H4z', 'M13 13h7v7h-7z'],
  connect: ['M4 5h6v5H4z', 'M14 14h6v5h-6z', 'M7 10v6h7'],
  duplicate: ['M8 8h12v12H8z', 'M4 16V4h12'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13', 'M10 11v6', 'M14 11v6'],
  'order-front': ['M5 4h14', 'M12 20V8', 'M7 13l5-5 5 5'],
  'order-forward': ['M12 20V6', 'M7 11l5-5 5 5'],
  'order-backward': ['M12 4v14', 'M7 13l5 5 5-5'],
  'order-back': ['M12 4v12', 'M7 11l5 5 5-5', 'M5 20h14'],
  objects: ['M4 6h2', 'M9 6h11', 'M8 12h2', 'M13 12h7', 'M8 18h2', 'M13 18h7'],
  'align-left': ['M4 6h16', 'M4 12h10', 'M4 18h13'],
  'align-center': ['M4 6h16', 'M7 12h10', 'M5.5 18h13'],
  'align-right': ['M4 6h16', 'M10 12h10', 'M7 18h13'],
  eye: ['M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z', 'M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z'],
  menu: ['M4 7h16', 'M4 12h16', 'M4 17h16'],
  users: ['M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z', 'M2.5 20a6.5 6.5 0 0 1 13 0', 'M16 4.3a3.5 3.5 0 0 1 0 6.4', 'M18 14.2a6.5 6.5 0 0 1 3.5 5.8'],
  code: ['M8 7l-5 5 5 5', 'M16 7l5 5-5 5', 'M13.5 4.5l-3 15'],
  user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4.5 20.5a7.5 7.5 0 0 1 15 0'],
  maximize: ['M4 9V4h5', 'M15 4h5v5', 'M20 15v5h-5', 'M9 20H4v-5'],
  pages: ['M8 4h11a1 1 0 0 1 1 1v11', 'M5 8h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z'],
  grip: ['M9 6h.01', 'M15 6h.01', 'M9 12h.01', 'M15 12h.01', 'M9 18h.01', 'M15 18h.01'],
  more: ['M6 12h.01', 'M12 12h.01', 'M18 12h.01'],
  'more-vertical': ['M12 6h.01', 'M12 12h.01', 'M12 18h.01'],
  calendar: ['M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z', 'M4 10h16', 'M8 3v4', 'M16 3v4'],
  copy: ['M9 9h10a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H10a1 1 0 0 1-1-1z', 'M15 5V4a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h1'],
  paste: ['M9 4h6v3H9z', 'M15 5h3a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h3', 'M9 13h6', 'M9 16h4'],
  rename: ['M4 20h4L19 9l-4-4L4 16z', 'M13 7l4 4'],
  arrow: ['M5 12h14', 'M13 6l6 6-6 6'],
  shapes: ['M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z', 'M11 11h9v9h-9z'],
  stroke: ['M4 5.5h16', 'M4 10h16v2.5H4z', 'M4 16h16v3.5H4z'],
  eyedropper: ['M13 7l4 4', 'M15.5 4.5a2.1 2.1 0 0 1 3 0l1 1a2.1 2.1 0 0 1 0 3L17 11l-4-4z', 'M14 8l-8.5 8.5V19h2.5L16.5 10.5'],
  'line-solid': ['M5 19L19 5'],
  'line-animated': ['M5 19h.01', 'M9 15h.01', 'M13 11h.01', 'M17 7h.01', 'M19 5l-2 .4 .4 -2'],
  'line-dashed': ['M5 19l2.5-2.5', 'M10.75 13.25l2.5-2.5', 'M16.5 7.5L19 5'],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M20 20l-4-4'],
  none: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M5.6 18.4L18.4 5.6'],
  link: ['M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1', 'M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1'],
};
