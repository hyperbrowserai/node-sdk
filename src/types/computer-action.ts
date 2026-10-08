/**
 * Computer action types enumeration
 */
export enum ComputerAction {
  CLICK = "click",
  DRAG = "drag",
  HOLD_KEY = "hold_key",
  MOUSE_DOWN = "mouse_down",
  MOUSE_UP = "mouse_up",
  PRESS_KEYS = "press_keys",
  MOVE_MOUSE = "move_mouse",
  SCREENSHOT = "screenshot",
  SCROLL = "scroll",
  TYPE_TEXT = "type_text",
  GET_CLIPBOARD_TEXT = "get_clipboard_text",
  PUT_SELECTION_TEXT = "put_selection_text",
  LIST_WINDOWS = "list_windows",
}

export type ComputerActionMouseButton = "left" | "right" | "middle" | "back" | "forward" | "wheel";

/**
 * Coordinate model for drag actions
 */
export interface Coordinate {
  x: number;
  y: number;
}

/**
 * Parameters for click action
 */
export interface ClickActionParams {
  action: ComputerAction.CLICK;
  x?: number;
  y?: number;
  button?: ComputerActionMouseButton;
  numClicks?: number;
  keys?: string[];
  returnScreenshot?: boolean;
}

/**
 * Parameters for drag action
 */
export interface DragActionParams {
  action: ComputerAction.DRAG;
  path: Coordinate[];
  keys?: string[];
  returnScreenshot?: boolean;
}

/**
 * Parameters for press keys action
 */
export interface PressKeysActionParams {
  action: ComputerAction.PRESS_KEYS;
  keys: string[];
  returnScreenshot?: boolean;
}

/**
 * Parameters for move mouse action
 */
export interface MoveMouseActionParams {
  action: ComputerAction.MOVE_MOUSE;
  x: number;
  y: number;
  returnScreenshot?: boolean;
}

/**
 * Parameters for screenshot action
 */
export interface ScreenshotActionParams {
  action: ComputerAction.SCREENSHOT;
}

/** Parameters for reading the desktop cursor position. */
export interface CursorPositionActionParams {
  action: "cursor_position";
  returnScreenshot?: boolean;
}

/**
 * Parameters for scroll action
 */
export interface ScrollActionParams {
  action: ComputerAction.SCROLL;
  x: number;
  y: number;
  keys?: string[];
  scrollX: number;
  scrollY: number;
  returnScreenshot?: boolean;
}

/** Parameters for scrolling without moving the desktop cursor. */
export type ScrollAtCursorActionParams = Omit<ScrollActionParams, "x" | "y">;

/**
 * Parameters for type text action
 */
export interface TypeTextActionParams {
  action: ComputerAction.TYPE_TEXT;
  text: string;
  returnScreenshot?: boolean;
}

/**
 * Parameters for hold key action
 */
export interface HoldKeyActionParams {
  action: ComputerAction.HOLD_KEY;
  key: string;
  duration: number;
  returnScreenshot?: boolean;
}

/**
 * Parameters for mouse down action
 */
export interface MouseDownActionParams {
  action: ComputerAction.MOUSE_DOWN;
  button?: ComputerActionMouseButton;
  returnScreenshot?: boolean;
}

/**
 * Parameters for mouse up action
 */
export interface MouseUpActionParams {
  action: ComputerAction.MOUSE_UP;
  button?: ComputerActionMouseButton;
  returnScreenshot?: boolean;
}

export interface GetClipboardTextActionParams {
  action: ComputerAction.GET_CLIPBOARD_TEXT;
  returnScreenshot?: boolean;
}

export interface PutSelectionTextActionParams {
  action: ComputerAction.PUT_SELECTION_TEXT;
  text: string;
  returnScreenshot?: boolean;
}

/**
 * Parameters for list windows action.
 */
export interface ListWindowsActionParams {
  action: ComputerAction.LIST_WINDOWS;
  returnScreenshot?: boolean;
}

/**
 * Existing action parameters; cursor reads and cursor-relative scrolling use dedicated helpers.
 */
export type ComputerActionParams =
  | ClickActionParams
  | DragActionParams
  | PressKeysActionParams
  | MoveMouseActionParams
  | ScreenshotActionParams
  | ScrollActionParams
  | TypeTextActionParams
  | HoldKeyActionParams
  | MouseDownActionParams
  | MouseUpActionParams
  | GetClipboardTextActionParams
  | PutSelectionTextActionParams
  | ListWindowsActionParams;

export interface ComputerActionResponseDataClipboardText {
  clipboardText?: string;
}

/**
 * A single visible top-level X11/native window entry.
 */
export interface ComputerActionWindow {
  id: string;
  name: string;
  active: boolean;
}

/**
 * Response data for the list windows action.
 */
export interface ComputerActionResponseDataListWindows {
  activeWindowId: string;
  windows: ComputerActionWindow[];
}

/** Desktop cursor coordinates in physical screen pixels. */
export interface ComputerActionResponseDataCursorPosition {
  x: number;
  y: number;
}

export type ComputerActionResponseData =
  | ComputerActionResponseDataClipboardText
  | ComputerActionResponseDataListWindows;

/**
 * Response from computer action API
 */
export interface ComputerActionResponse {
  success: boolean;
  screenshot?: string;
  data?: ComputerActionResponseData;
  error?: string;
  message?: string;
}

/** Response from reading the desktop cursor position. */
export interface CursorPositionActionResponse extends Omit<ComputerActionResponse, "data"> {
  data?: ComputerActionResponseDataCursorPosition;
}
