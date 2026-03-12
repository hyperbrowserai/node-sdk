import type { CreateSandboxParams } from "./sandbox";

// Keep the public sandbox create contract aligned with the control API.
type Assert<T extends true> = T;

type HasSandboxNameSource =
  Extract<CreateSandboxParams, { sandboxName: string }> extends never ? false : true;

type SnapshotSourceAllowed = { snapshotName: "snapshot" } extends CreateSandboxParams
  ? true
  : false;

type ImageSourceAllowed = { imageName: "image" } extends CreateSandboxParams ? true : false;

type _NoSandboxNameSource = Assert<HasSandboxNameSource extends false ? true : false>;
type _SnapshotSourceAllowed = Assert<SnapshotSourceAllowed>;
type _ImageSourceAllowed = Assert<ImageSourceAllowed>;
