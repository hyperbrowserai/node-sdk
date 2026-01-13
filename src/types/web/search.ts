import { Country, State } from "../constants";

export type WebSearchFiletype = "pdf" | "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx" | "html";
export type WebSearchStatus = "completed" | "failed" | "pending" | "running";

export interface WebSearchFilters {
  exactPhrase?: boolean;
  semanticPhrase?: boolean;
  excludeTerms?: string[];
  boostTerms?: string[];
  filetype?: WebSearchFiletype;
  site?: string;
  excludeSite?: string;
  intitle?: string;
  inurl?: string;
}

export interface WebSearchLocation {
  country?: Country;
  state?: State;
  city?: string;
}

export interface WebSearchParams {
  query: string;
  page?: number;
  maxAgeSeconds?: number;
  location?: WebSearchLocation;
  filters?: WebSearchFilters;
}

export interface WebSearchResultItem {
  title: string;
  url: string;
  description: string;
}

export interface WebSearchResponseData {
  query: string;
  results: WebSearchResultItem[];
}

export interface WebSearchResponse {
  jobId: string;
  status: WebSearchStatus;
  error?: string;
  data?: WebSearchResponseData;
}
