import { HyperbrowserError } from "../client";
import {
  CreateExtensionParams,
  CreateExtensionResponse,
  ListExtensionsResponse,
} from "../types/extension";
import { BaseService } from "./base";
import FormData from "form-data";
import fs from "node:fs/promises";
import path from "node:path";

async function checkFileExists(filePath: string) {
  try {
    await fs.access(filePath, fs.constants.R_OK);
    const extension = path.extname(filePath);
    if (extension !== ".zip") {
      throw new HyperbrowserError("Extension file provided is not zipped", undefined);
    }
  } catch (err) {
    if (err instanceof HyperbrowserError) {
      throw err;
    }
    throw new HyperbrowserError("Could not find extension file", undefined);
  }
}

export class ExtensionService extends BaseService {
  /**
   * Upload an extension to hyperbrowser
   * @param params Configuration parameters for the new extension
   */
  async create(params: CreateExtensionParams): Promise<CreateExtensionResponse> {
    try {
      await checkFileExists(params.filePath);

      const form = new FormData();
      form.append("file", await fs.readFile(params.filePath), {
        filename: path.basename(params.filePath),
        contentType: "application/zip",
      });

      if (params.name) {
        form.append("name", params.name);
      }

      const response = await this.request<CreateExtensionResponse>("/extensions/add", {
        method: "POST",
        body: form,
        headers: form.getHeaders(),
      });
      return response;
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError("Failed to upload extension", undefined);
    }
  }

  /**
   * List all uploaded extensions for the account
   */
  async list(): Promise<ListExtensionsResponse> {
    try {
      return await this.request("/extensions/list", { method: "GET" });
    } catch (err) {
      if (err instanceof HyperbrowserError) {
        throw err;
      } else {
        throw new HyperbrowserError("Could not list extensions", undefined);
      }
    }
  }
}
