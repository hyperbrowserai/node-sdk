import { HyperbrowserError } from "../../client";
import { AgentTaskListParams, AgentTaskListResponse } from "../../types/agents/task";
import { BaseService } from "../base";

export abstract class AgentTaskListService extends BaseService {
  protected abstract readonly taskPath: string;
  protected abstract readonly taskLabel: string;

  async list(params: AgentTaskListParams = {}): Promise<AgentTaskListResponse> {
    try {
      return await this.request<AgentTaskListResponse>(`/task/${this.taskPath}`, undefined, {
        task: params.task,
        page: params.page,
        limit: params.limit,
      });
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError(`Failed to list ${this.taskLabel} task jobs`, undefined);
    }
  }
}
