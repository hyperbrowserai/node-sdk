// Typed response shape for the branding extraction output.
//
// Every field is optional because the server may return a partial profile
// when the LLM refuses or fails. Nested types are intentionally closed — they
// describe the exact set of keys the server emits today, so typos like
// `colors.prmary` are caught by tsc. Forward-compat for future server-added
// fields happens at SDK version boundaries (upgrade the SDK package).
//
// If the server adds a new debug key under the profile root (e.g. another
// `__llm_*` dump), consumers that want to read it can cast:
//   (page.branding as Record<string, unknown>).__llm_metadata

export type BrandingColorScheme = "light" | "dark";

export type BrandingPersonalityTone =
  | "professional"
  | "playful"
  | "modern"
  | "traditional"
  | "minimalist"
  | "bold";

export type BrandingPersonalityEnergy = "low" | "medium" | "high";

export type BrandingFontRole =
  | "heading"
  | "body"
  | "monospace"
  | "display"
  | "unknown";

export type BrandingDesignFramework =
  | "tailwind"
  | "bootstrap"
  | "material"
  | "chakra"
  | "custom"
  | "unknown";

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
  // textColor / borderColor / shadow pass null through from the server's
  // InputSnapshot when the DOM probe couldn't read the value (hexify returns
  // null with no fallback for inputs). See ignore/evals/claude/ours.json for
  // a live example of `borderColor: null`.
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
  // LLM-extracted dicts — individual entries may be null when the model
  // couldn't resolve a specific bucket.
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
  /** Parent <a href> when the logo is linked (usually the homepage). */
  logoHref?: string | null;
  /** Alt text on the logo or its parent aria-label. */
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
