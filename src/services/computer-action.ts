import { SessionDetail } from "../types";
import {
  ComputerAction,
  ComputerActionParams,
  ComputerActionResponse,
  Coordinate,
  ComputerActionMouseButton,
} from "../types/computer-action";
import { BaseService } from "./base";
import { HyperbrowserError } from "../client";

export class ComputerActionService extends BaseService {
  private async executeRequest(
    session: SessionDetail | string,
    params: ComputerActionParams
  ): Promise<ComputerActionResponse> {
    try {
      let sessionDetail: SessionDetail;

      if (typeof session === "string") {
        sessionDetail = await this.request<SessionDetail>(`/session/${session}`);
      } else {
        sessionDetail = session;
      }

      if (!sessionDetail.computerActionEndpoint) {
        throw new HyperbrowserError(
          "Computer action endpoint not available for this session",
          undefined
        );
      }

      return await this.request<ComputerActionResponse>(
        sessionDetail.computerActionEndpoint,
        {
          method: "POST",
          body: JSON.stringify(params),
        },
        undefined,
        true
      );
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError("Failed to execute computer action", undefined);
    }
  }

  async click(
    session: SessionDetail | string,
    x: number,
    y: number,
    button: ComputerActionMouseButton = "left",
    numClicks: number = 1,
    returnScreenshot: boolean = false
  ): Promise<ComputerActionResponse> {
    return this.executeRequest(session, {
      action: ComputerAction.CLICK,
      x,
      y,
      button,
      numClicks,
      returnScreenshot,
    });
  }

  async typeText(
    session: SessionDetail | string,
    text: string,
    returnScreenshot: boolean = false
  ): Promise<ComputerActionResponse> {
    return this.executeRequest(session, {
      action: ComputerAction.TYPE_TEXT,
      text,
      returnScreenshot,
    });
  }

  async screenshot(session: SessionDetail | string): Promise<ComputerActionResponse> {
    return this.executeRequest(session, {
      action: ComputerAction.SCREENSHOT,
    });
  }

  async pressKeys(
    session: SessionDetail | string,
    keys: string[],
    returnScreenshot: boolean = false
  ): Promise<ComputerActionResponse> {
    return this.executeRequest(session, {
      action: ComputerAction.PRESS_KEYS,
      keys,
      returnScreenshot,
    });
  }

  async drag(
    session: SessionDetail | string,
    path: Coordinate[],
    returnScreenshot: boolean = false
  ): Promise<ComputerActionResponse> {
    return this.executeRequest(session, {
      action: ComputerAction.DRAG,
      path,
      returnScreenshot,
    });
  }

  async moveMouse(
    session: SessionDetail | string,
    x: number,
    y: number,
    returnScreenshot: boolean = false
  ): Promise<ComputerActionResponse> {
    return this.executeRequest(session, {
      action: ComputerAction.MOVE_MOUSE,
      x,
      y,
      returnScreenshot,
    });
  }

  async scroll(
    session: SessionDetail | string,
    x: number,
    y: number,
    scrollX: number,
    scrollY: number,
    returnScreenshot: boolean = false
  ): Promise<ComputerActionResponse> {
    return this.executeRequest(session, {
      action: ComputerAction.SCROLL,
      x,
      y,
      scrollX,
      scrollY,
      returnScreenshot,
    });
  }

  async holdKey(
    session: SessionDetail | string,
    key: string,
    duration: number,
    returnScreenshot: boolean = false
  ): Promise<ComputerActionResponse> {
    return this.executeRequest(session, {
      action: ComputerAction.HOLD_KEY,
      key,
      duration,
      returnScreenshot,
    });
  }

  async mouseDown(
    session: SessionDetail | string,
    button: ComputerActionMouseButton = "left",
    returnScreenshot: boolean = false
  ): Promise<ComputerActionResponse> {
    return this.executeRequest(session, {
      action: ComputerAction.MOUSE_DOWN,
      button,
      returnScreenshot,
    });
  }

  async mouseUp(
    session: SessionDetail | string,
    button: ComputerActionMouseButton = "left",
    returnScreenshot: boolean = false
  ): Promise<ComputerActionResponse> {
    return this.executeRequest(session, {
      action: ComputerAction.MOUSE_UP,
      button,
      returnScreenshot,
    });
  }

  async getClipboardText(
    session: SessionDetail | string,
    returnScreenshot: boolean = false
  ): Promise<ComputerActionResponse> {
    return this.executeRequest(session, {
      action: ComputerAction.GET_CLIPBOARD_TEXT,
      returnScreenshot,
    });
  }

  async putSelectionText(
    session: SessionDetail | string,
    text: string,
    returnScreenshot: boolean = false
  ): Promise<ComputerActionResponse> {
    return this.executeRequest(session, {
      action: ComputerAction.PUT_SELECTION_TEXT,
      text,
      returnScreenshot,
    });
  }
}
