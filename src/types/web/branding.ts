export type BrandingColorScheme = "light" | "dark";

export type BrandingPersonalityTone =
  | "professional"
  | "playful"
  | "modern"
  | "traditional"
  | "minimalist"
  | "bold";

export type BrandingPersonalityEnergy = "low" | "medium" | "high";

// `(string & {})` keeps the literal arm visible to autocomplete while
// accepting any string — without it the union collapses to bare `string`.
export type BrandingFontRole =
  | "heading"
  | "body"
  | "monospace"
  | "display"
  | "unknown"
  | (string & {});

export type BrandingDesignFramework =
  | "tailwind"
  | "bootstrap"
  | "material"
  | "chakra"
  | "custom"
  | "unknown"
  | (string & {});

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
}

export interface BrandingFont {
  family: string;
  role?: BrandingFontRole;
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
}

export interface BrandingInputStyle {
  background?: string;
  textColor?: string | null;
  borderColor?: string | null;
  focusBorderColor?: string | null;
  borderRadius?: string;
  borderRadiusCorners?: BrandingBorderRadiusCorners;
  shadow?: string | null;
}

export interface BrandingComponents {
  buttonPrimary?: BrandingButtonStyle;
  buttonSecondary?: BrandingButtonStyle;
  input?: BrandingInputStyle;
}

export interface BrandingFontFamilies {
  primary?: string;
  heading?: string;
  code?: string;
}

export interface BrandingFontStacks {
  primary?: string[];
  heading?: string[];
  body?: string[];
  paragraph?: string[];
}

export interface BrandingFontSizes {
  h1?: string;
  h2?: string;
  h3?: string;
  body?: string;
  small?: string;
}

export interface BrandingTypography {
  fontFamilies?: BrandingFontFamilies;
  fontStacks?: BrandingFontStacks;
  fontSizes?: BrandingFontSizes;
  lineHeights?: Record<string, number | null>;
  fontWeights?: Record<string, number | null>;
}

export interface BrandingSpacing {
  baseUnit?: number;
  borderRadius?: string;
  padding?: Record<string, number | null>;
  margins?: Record<string, number | null>;
  gridGutter?: number;
}

export interface BrandingImages {
  logo?: string | null;
  logoHref?: string | null;
  logoAlt?: string | null;
  favicon?: string | null;
  ogImage?: string | null;
}

export interface BrandingPersonality {
  tone?: BrandingPersonalityTone;
  energy?: BrandingPersonalityEnergy;
  targetAudience?: string;
}

export interface BrandingDesignSystem {
  framework?: BrandingDesignFramework;
  componentLibrary?: string;
}

export interface BrandingConfidence {
  buttons?: number;
  colors?: number;
  overall?: number;
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
}
