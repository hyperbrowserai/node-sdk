import { describe, expect, expectTypeOf, test } from "vitest";
import type {
  ClickActionParams,
  DragActionParams,
  ScrollActionParams,
  ScrollAtCursorActionParams,
  ComputerActionParams,
  ComputerActionResponseData,
  ComputerActionResponse,
  CursorPositionActionParams,
  CursorPositionActionResponse,
  ComputerActionResponseDataCursorPosition,
  CompleteSandboxImageBuildParams,
  CreateSandboxImageBuildParams,
  Sandbox,
  SandboxExecParams,
  SandboxImageBuildInputFormat,
  SandboxImageBuildListParams,
  SandboxImageBuildStatus,
  SandboxProcessResult,
  SandboxImageListResponse,
  SandboxNetworkPolicy,
  SandboxSnapshotListResponse,
  SessionRegion,
  SessionStatus,
  VolumeListResponse,
} from "../../src/types";
import { ComputerAction } from "../../src/types";
import { ComputerActionService } from "../../src/services/computer-action";

function existingResponseConsumer(data: ComputerActionResponseData): string {
  if ("windows" in data) return data.activeWindowId;
  return data.clipboardText ?? "";
}

function existingActionConsumer(params: ComputerActionParams): string {
  switch (params.action) {
    case ComputerAction.CLICK:
    case ComputerAction.DRAG:
    case ComputerAction.HOLD_KEY:
    case ComputerAction.MOUSE_DOWN:
    case ComputerAction.MOUSE_UP:
    case ComputerAction.PRESS_KEYS:
    case ComputerAction.MOVE_MOUSE:
    case ComputerAction.SCREENSHOT:
    case ComputerAction.SCROLL:
    case ComputerAction.TYPE_TEXT:
    case ComputerAction.GET_CLIPBOARD_TEXT:
    case ComputerAction.PUT_SELECTION_TEXT:
    case ComputerAction.LIST_WINDOWS:
      return params.action;
    default: {
      const exhaustive: never = params;
      return exhaustive;
    }
  }
}

describe("public type compatibility", () => {
  test("exports cursor-position requests and typed coordinates with optional pointer modifiers", () => {
    const request: CursorPositionActionParams = { action: "cursor_position" };
    const response: ComputerActionResponseDataCursorPosition = { x: 10, y: 20 };
    const scroll: ScrollAtCursorActionParams = {
      action: ComputerAction.SCROLL,
      scrollX: 0,
      scrollY: 1,
      keys: ["Shift_L"],
    };
    expect(request.action).toBe("cursor_position");
    expect(response).toEqual({ x: 10, y: 20 });
    expect(scroll).not.toHaveProperty("x");
    expectTypeOf<ClickActionParams["keys"]>().toEqualTypeOf<string[] | undefined>();
    expectTypeOf<DragActionParams["keys"]>().toEqualTypeOf<string[] | undefined>();
    expectTypeOf<ScrollActionParams["keys"]>().toEqualTypeOf<string[] | undefined>();
  });

  test("preserves existing coordinate, response and exhaustive action consumers", () => {
    const actionNames: Record<ComputerAction, string> = {
      click: "click",
      drag: "drag",
      hold_key: "hold_key",
      mouse_down: "mouse_down",
      mouse_up: "mouse_up",
      press_keys: "press_keys",
      move_mouse: "move_mouse",
      screenshot: "screenshot",
      scroll: "scroll",
      type_text: "type_text",
      get_clipboard_text: "get_clipboard_text",
      put_selection_text: "put_selection_text",
      list_windows: "list_windows",
    };
    const scroll: ScrollActionParams = {
      action: ComputerAction.SCROLL,
      x: 10,
      y: 20,
      scrollX: 0,
      scrollY: 1,
    };
    const x: number = scroll.x;
    const y: number = scroll.y;
    expect(x + y).toBe(30);
    expect(actionNames[scroll.action]).toBe("scroll");
    expect(existingActionConsumer(scroll)).toBe("scroll");
    expect(existingResponseConsumer({ clipboardText: "hello" })).toBe("hello");
    expectTypeOf<ScrollActionParams["x"]>().toEqualTypeOf<number>();
    expectTypeOf<ScrollActionParams["y"]>().toEqualTypeOf<number>();
    expectTypeOf<Parameters<ComputerActionService["click"]>[1]>().toEqualTypeOf<number>();
    expectTypeOf<Parameters<ComputerActionService["click"]>[2]>().toEqualTypeOf<number>();
    expectTypeOf<Parameters<ComputerActionService["scroll"]>[1]>().toEqualTypeOf<number>();
    expectTypeOf<Parameters<ComputerActionService["scroll"]>[2]>().toEqualTypeOf<number>();
    expectTypeOf<ReturnType<ComputerActionService["scroll"]>>().toEqualTypeOf<
      Promise<ComputerActionResponse>
    >();
    expectTypeOf<ReturnType<ComputerActionService["cursorPosition"]>>().toEqualTypeOf<
      Promise<CursorPositionActionResponse>
    >();
  });
  test("keeps newly available response data optional", () => {
    const imageResponse: SandboxImageListResponse = { images: [] };
    const snapshotResponse: SandboxSnapshotListResponse = { snapshots: [] };
    const volumeResponse: VolumeListResponse = { volumes: [] };

    expect(imageResponse.totalCount).toBeUndefined();
    expect(snapshotResponse.page).toBeUndefined();
    expect(volumeResponse.perPage).toBeUndefined();
    expectTypeOf<Sandbox["network"]>().toEqualTypeOf<SandboxNetworkPolicy | null | undefined>();
  });

  test("includes public server region and status values", () => {
    const region: SessionRegion = "us";
    const status: SessionStatus = "close-error";

    expect(region).toBe("us");
    expect(status).toBe("close-error");
  });

  test("only accepts the image build formats and platform supported by the server", () => {
    expectTypeOf<CreateSandboxImageBuildParams["inputFormat"]>().toEqualTypeOf<
      SandboxImageBuildInputFormat | undefined
    >();
    expectTypeOf<SandboxImageBuildInputFormat>().toEqualTypeOf<
      | "rootfs_export_tar_gz"
      | "dockerfile_context_tar_gz"
      | "dockerfile_context_manifest_v1"
      | "docker_image_manifest_v1"
    >();
    expectTypeOf<CreateSandboxImageBuildParams["sourcePlatform"]>().toEqualTypeOf<
      "linux/amd64" | undefined
    >();
    expectTypeOf<CompleteSandboxImageBuildParams["inputFormat"]>().toEqualTypeOf<
      SandboxImageBuildInputFormat | undefined
    >();
    expectTypeOf<CreateSandboxImageBuildParams["builderCpus"]>().toEqualTypeOf<
      number | undefined
    >();
    expectTypeOf<SandboxExecParams["maxOutputBytes"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<SandboxProcessResult["outputTruncated"]>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<SandboxImageBuildListParams["status"]>().toEqualTypeOf<
      SandboxImageBuildStatus | undefined
    >();
    expectTypeOf<"cancelled">().not.toExtend<SandboxImageBuildStatus>();
    expectTypeOf<"BUILDING">().not.toExtend<SandboxImageBuildStatus>();
    expectTypeOf<"canceled">().toExtend<SandboxImageBuildStatus>();
  });
});
