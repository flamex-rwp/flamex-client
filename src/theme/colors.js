/**
 * Cherry Red / Lipstick Red Theme Color Palette
 * Primary: Cherry Red (#DC143C or #C41E3A)
 */

export const colors = {
  // Primary Colors - Cherry Red
  primary: '#DC143C',        // Cherry Red / Crimson
  primaryDark: '#A0001A',    // Darker red
  primaryLight: '#FF6B6B',   // Light red
  
  // Alternative Primary (Lipstick Red)
  primaryAlt: '#C41E3A',     // Lipstick Red
  
  // Secondary Colors - Charcoal Grey
  secondary: '#2C3E50',      // Charcoal Grey
  secondaryLight: '#95A5A6', // Light Grey
  secondaryDark: '#1A252F',  // Darker grey
  
  // Accent
  accent: '#FFFFFF',         // White
  
  // Functional Colors
  success: '#48BB78',        // Green (keep existing)
  successDark: '#38A169',
  warning: '#ED8936',        // Orange/Yellow (keep existing)
  warningDark: '#DD6B20',
  danger: '#DC143C',         // Use primary red
  dangerDark: '#A0001A',
  info: '#4299E1',           // Blue
  infoDark: '#3182CE',
  
  // Neutral Colors
  text: '#2D3748',
  textLight: '#718096',
  textMuted: '#A0AEC0',
  border: '#E2E8F0',
  borderLight: '#F1F5F9',
  background: '#F5F5F5',
  backgroundLight: '#FFFFFF',
  
  // Gradients
  gradients: {
    primary: 'linear-gradient(135deg, #DC143C 0%, #A0001A 100%)',
    primaryAlt: 'linear-gradient(135deg, #C41E3A 0%, #A0001A 100%)',
    secondary: 'linear-gradient(135deg, #95A5A6 0%, #2C3E50 100%)',
    secondaryAlt: 'linear-gradient(135deg, #2C3E50 0%, #1A252F 100%)',
    background: 'linear-gradient(135deg, #95A5A6 0%, #FFFFFF 100%)',
    success: 'linear-gradient(135deg, #48BB78 0%, #38A169 100%)',
    warning: 'linear-gradient(135deg, #ED8936 0%, #DD6B20 100%)',
  },
  
  // Shadows
  shadows: {
    sm: '0 2px 4px rgba(220, 20, 60, 0.1)',
    md: '0 4px 15px rgba(220, 20, 60, 0.2)',
    lg: '0 8px 25px rgba(220, 20, 60, 0.3)',
    xl: '0 20px 40px rgba(220, 20, 60, 0.2)',
    focus: '0 0 0 3px rgba(220, 20, 60, 0.2)',
  }
};

export default colors;

