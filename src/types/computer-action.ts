/**
 * Computer action types enumeration
 */
export enum ComputerAction {
  CLICK = "click",
  DRAG = "drag",
  PRESS_KEYS = "press_keys",
  MOVE_MOUSE = "move_mouse",
  SCREENSHOT = "screenshot",
  SCROLL = "scroll",
  TYPE_TEXT = "type_text",
}

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
  x: number;
  y: number;
  button?: "left" | "right" | "middle" | "back" | "forward" | "wheel";
  numClicks?: number;
  returnScreenshot?: boolean;
}

/**
 * Parameters for drag action
 */
export interface DragActionParams {
  action: ComputerAction.DRAG;
  path: Coordinate[];
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

/**
 * Parameters for scroll action
 */
export interface ScrollActionParams {
  action: ComputerAction.SCROLL;
  x: number;
  y: number;
  scrollX: number;
  scrollY: number;
  returnScreenshot?: boolean;
}

/**
 * Parameters for type text action
 */
export interface TypeTextActionParams {
  action: ComputerAction.TYPE_TEXT;
  text: string;
  returnScreenshot?: boolean;
}

/**
 * Union type for all computer action parameters
 */
export type ComputerActionParams =
  | ClickActionParams
  | DragActionParams
  | PressKeysActionParams
  | MoveMouseActionParams
  | ScreenshotActionParams
  | ScrollActionParams
  | TypeTextActionParams;

/**
 * Response from computer action API
 */
export interface ComputerActionResponse {
  success: boolean;
  screenshot?: string;
  error?: string;
  message?: string;
}
