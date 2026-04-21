export type OAuthSessionFile = {
  version: number;
  base_url: string;
  client_id: string;
  token_type?: string;
  access_token: string;
  refresh_token: string;
  expiry: string;
  scope?: string;
  refresh_token_expiry?: string;
};

export type ControlPlaneAuthMode =
  | {
      kind: "api_key";
      apiKey: string;
    }
  | {
      kind: "oauth";
      profile: string;
      sessionPath: string;
      lockPath: string;
      baseUrl: string;
      lockTimeoutMs: number;
      lockPollIntervalMs: number;
      lockStaleMs: number;
    };

export type OAuthControlPlaneAuthMode = Extract<ControlPlaneAuthMode, { kind: "oauth" }>;

export type AuthorizedHeaders = {
  headers: Record<string, string>;
  accessToken?: string;
};
