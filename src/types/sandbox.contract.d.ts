import type { CreateSandboxParams } from "./sandbox";

// Keep the public sandbox create contract aligned with the control API.
type Assert<T extends true> = T;

type HasSandboxNameSource =
  Extract<CreateSandboxParams, { sandboxName: string }> extends never ? false : true;

type SnapshotSourceAllowed = { snapshotName: "snapshot" } extends CreateSandboxParams
  ? true
  : false;

type ImageSourceAllowed = { imageName: "image" } extends CreateSandboxParams ? true : false;
type ImageCpuAllowed = { imageName: "image"; cpu: 2 } extends CreateSandboxParams ? true : false;
type ImageMemoryAllowed = { imageName: "image"; memory: 2048 } extends CreateSandboxParams
  ? true
  : false;
type ImageDiskAllowed = { imageName: "image"; disk: 8192 } extends CreateSandboxParams
  ? true
  : false;
type SnapshotCpuAllowed = { snapshotName: "snapshot"; cpu: 2 } extends CreateSandboxParams
  ? true
  : false;
type SnapshotMemoryAllowed = { snapshotName: "snapshot"; memory: 2048 } extends CreateSandboxParams
  ? true
  : false;
type SnapshotDiskAllowed = { snapshotName: "snapshot"; disk: 8192 } extends CreateSandboxParams
  ? true
  : false;

type _NoSandboxNameSource = Assert<HasSandboxNameSource extends false ? true : false>;
type _SnapshotSourceAllowed = Assert<SnapshotSourceAllowed>;
type _ImageSourceAllowed = Assert<ImageSourceAllowed>;
type _ImageCpuAllowed = Assert<ImageCpuAllowed>;
type _ImageMemoryAllowed = Assert<ImageMemoryAllowed>;
type _ImageDiskAllowed = Assert<ImageDiskAllowed>;
type _SnapshotCpuDisallowed = Assert<SnapshotCpuAllowed extends false ? true : false>;
type _SnapshotMemoryDisallowed = Assert<SnapshotMemoryAllowed extends false ? true : false>;
type _SnapshotDiskDisallowed = Assert<SnapshotDiskAllowed extends false ? true : false>;
