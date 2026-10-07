import { describe, expect, expectTypeOf, test } from "vitest";
import type {
  ClickActionParams,
  DragActionParams,
  ScrollActionParams,
  CursorPositionActionParams,
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

describe("public type compatibility", () => {
  test("exports cursor-position requests and typed coordinates with optional pointer modifiers", () => {
    const request: CursorPositionActionParams = { action: ComputerAction.CURSOR_POSITION };
    const response: ComputerActionResponseDataCursorPosition = { x: 10, y: 20 };
    const scroll: ScrollActionParams = {
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
