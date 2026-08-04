import { describe, expect, expectTypeOf, test } from "vitest";
import type {
  CompleteSandboxImageBuildParams,
  CreateSandboxImageBuildParams,
  Sandbox,
  SandboxImageBuildListParams,
  SandboxImageBuildStatus,
  SandboxImageListResponse,
  SandboxNetworkPolicy,
  SandboxSnapshotListResponse,
  SessionRegion,
  SessionStatus,
  VolumeListResponse,
} from "../../../src/types";

describe("public type compatibility", () => {
  test("keeps newly available response data optional", () => {
    const imageResponse: SandboxImageListResponse = { images: [] };
    const snapshotResponse: SandboxSnapshotListResponse = { snapshots: [] };
    const volumeResponse: VolumeListResponse = { volumes: [] };

    expect(imageResponse.totalCount).toBeUndefined();
    expect(snapshotResponse.page).toBeUndefined();
    expect(volumeResponse.perPage).toBeUndefined();
    expectTypeOf<Sandbox["network"]>().toEqualTypeOf<SandboxNetworkPolicy | undefined>();
  });

  test("includes public server region and status values", () => {
    const region: SessionRegion = "us";
    const status: SessionStatus = "close-error";

    expect(region).toBe("us");
    expect(status).toBe("close-error");
  });

  test("only accepts the image build format and platform supported by the server", () => {
    expectTypeOf<CreateSandboxImageBuildParams["inputFormat"]>().toEqualTypeOf<
      "rootfs_export_tar_gz" | undefined
    >();
    expectTypeOf<CreateSandboxImageBuildParams["sourcePlatform"]>().toEqualTypeOf<
      "linux/amd64" | undefined
    >();
    expectTypeOf<CompleteSandboxImageBuildParams["inputFormat"]>().toEqualTypeOf<
      "rootfs_export_tar_gz" | undefined
    >();
    expectTypeOf<SandboxImageBuildListParams["status"]>().toEqualTypeOf<
      SandboxImageBuildStatus | undefined
    >();
  });
});
