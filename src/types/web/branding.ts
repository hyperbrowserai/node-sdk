// Typed response shape for the branding extraction output.
// Every field is optional because the server may return a partial profile
// when the LLM refuses / fails — consumers should defensively check before
// reading nested fields. The trailing index signature keeps the interface
// forward-compatible if the server adds new keys.

export type BrandingColorScheme = "light" | "dark";

export type BrandingPersonalityTone =
  | "professional"
  | "playful"
  | "modern"
  | "traditional"
  | "minimalist"
  | "bold";

export type BrandingPersonalityEnergy = "low" | "medium" | "high";

export interface BrandingColors {
  primary?: string;
  secondary?: string;
  accent?: string;
  background?: string;
  textPrimary?: string;
  textSecondary?: string;
  link?: string;
  success?: string;
  warning?: string;
  error?: string;
  [key: string]: string | undefined;
}

export interface BrandingFont {
  family: string;
  role?: "heading" | "body" | "monospace" | "display" | "unknown";
  [key: string]: unknown;
}

export interface BrandingBorderRadiusCorners {
  topLeft?: string;
  topRight?: string;
  bottomRight?: string;
  bottomLeft?: string;
}

export interface BrandingButtonStyle {
  background?: string;
  textColor?: string;
  borderColor?: string;
  borderRadius?: string;
  borderRadiusCorners?: BrandingBorderRadiusCorners;
  shadow?: string;
  [key: string]: string | BrandingBorderRadiusCorners | undefined;
}

export interface BrandingInputStyle {
  background?: string;
  textColor?: string;
  borderColor?: string;
  focusBorderColor?: string;
  borderRadius?: string;
  borderRadiusCorners?: BrandingBorderRadiusCorners;
  shadow?: string;
  [key: string]: string | BrandingBorderRadiusCorners | undefined;
}

export interface BrandingComponents {
  buttonPrimary?: BrandingButtonStyle;
  buttonSecondary?: BrandingButtonStyle;
  input?: BrandingInputStyle;
  [key: string]: unknown;
}

export interface BrandingTypography {
  fontFamilies?: {
    primary?: string;
    heading?: string;
    code?: string;
    [key: string]: string | undefined;
  };
  fontStacks?: {
    primary?: string[];
    heading?: string[];
    body?: string[];
    paragraph?: string[];
    [key: string]: string[] | undefined;
  };
  fontSizes?: {
    h1?: string;
    h2?: string;
    h3?: string;
    body?: string;
    small?: string;
    [key: string]: string | undefined;
  };
  lineHeights?: Record<string, number | undefined>;
  fontWeights?: Record<string, number | undefined>;
}

export interface BrandingSpacing {
  baseUnit?: number;
  borderRadius?: string;
  padding?: Record<string, number>;
  margins?: Record<string, number>;
  gridGutter?: number;
  [key: string]: number | string | Record<string, number> | undefined;
}

export interface BrandingImages {
  logo?: string | null;
  /** Parent <a href> when the logo is linked (usually the homepage). */
  logoHref?: string | null;
  /** Alt text on the logo or its parent aria-label. */
  logoAlt?: string | null;
  favicon?: string | null;
  ogImage?: string | null;
  [key: string]: string | null | undefined;
}

export interface BrandingPersonality {
  tone?: BrandingPersonalityTone;
  energy?: BrandingPersonalityEnergy;
  targetAudience?: string;
}

export interface BrandingDesignSystem {
  framework?:
    | "tailwind"
    | "bootstrap"
    | "material"
    | "chakra"
    | "custom"
    | "unknown";
  componentLibrary?: string;
}

export interface BrandingConfidence {
  buttons?: number;
  colors?: number;
  overall?: number;
  [key: string]: number | undefined;
}

export interface BrandingProfile {
  colorScheme?: BrandingColorScheme;
  colors?: BrandingColors;
  fonts?: BrandingFont[];
  typography?: BrandingTypography;
  spacing?: BrandingSpacing;
  components?: BrandingComponents;
  images?: BrandingImages;
  personality?: BrandingPersonality;
  designSystem?: BrandingDesignSystem;
  confidence?: BrandingConfidence;
  /** Escape hatch for debug metadata (`__llm_*`) and future server additions. */
  [key: string]: unknown;
}
