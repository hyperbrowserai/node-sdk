import { HyperbrowserError } from "../client";
import { TeamCreditInfo } from "../types/team";
import { BaseService } from "./base";

export class TeamService extends BaseService {
  /**
   * Get the credit info for the team
   */
  async getCreditInfo(): Promise<TeamCreditInfo> {
    try {
      return await this.request<TeamCreditInfo>("/team/credit-info");
    } catch (error) {
      if (error instanceof HyperbrowserError) {
        throw error;
      }
      throw new HyperbrowserError("Failed to get team credit info", undefined);
    }
  }
}
