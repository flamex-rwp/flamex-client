// Flamex Brand Theme Colors
export const theme = {
  // Primary brand colors from logo
  primary: '#E31E24',        // Vibrant red from TURKISH badge
  primaryDark: '#B71C1C',    // Darker red for hover states
  primaryLight: '#FF5252',   // Lighter red for accents

  // Secondary colors
  secondary: '#3a3a3a',      // Dark charcoal from Flamex text
  secondaryLight: '#666666', // Lighter charcoal

  // Neutral colors
  background: '#f5f5f5',     // Light gray background
  surface: '#ffffff',        // White surface
  surfaceHover: '#f9f9f9',   // Slight hover effect

  // Text colors
  textPrimary: '#3a3a3a',    // Dark text
  textSecondary: '#666666',  // Gray text
  textLight: '#999999',      // Light gray text
  textOnPrimary: '#ffffff',  // White text on red

  // Status colors
  success: '#4CAF50',        // Green for success
  warning: '#FF9800',        // Orange for warnings
  error: '#E31E24',          // Red for errors (matches brand)
  info: '#2196F3',           // Blue for info

  // Borders and dividers
  border: '#e0e0e0',         // Light border
  borderDark: '#cccccc',     // Darker border
  divider: '#eeeeee',        // Divider line

  // Shadows
  shadow: '0 2px 8px rgba(227, 30, 36, 0.08)',  // Subtle red shadow
  shadowMedium: '0 4px 12px rgba(227, 30, 36, 0.12)',
  shadowLarge: '0 8px 24px rgba(227, 30, 36, 0.15)',

  // Card shadows
  cardShadow: '0 2px 4px rgba(0,0,0,0.1)',
  cardShadowHover: '0 4px 8px rgba(227, 30, 36, 0.15)',

  // Spacing
  spacing: {
    xs: '4px',
    sm: '8px',
    md: '16px',
    lg: '24px',
    xl: '32px',
  },

  // Border radius
  borderRadius: {
    sm: '4px',
    md: '8px',
    lg: '12px',
    xl: '16px',
    round: '50%',
  },

  // Typography
  fonts: {
    primary: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    heading: '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },

  // Button styles
  button: {
    primary: {
      background: '#E31E24',
      hover: '#B71C1C',
      active: '#9A0007',
      text: '#ffffff',
    },
    secondary: {
      background: '#3a3a3a',
      hover: '#2a2a2a',
      active: '#1a1a1a',
      text: '#ffffff',
    },
    outline: {
      background: 'transparent',
      border: '#E31E24',
      hover: '#E31E24',
      text: '#E31E24',
      textHover: '#ffffff',
    },
  },
};

export default theme;
