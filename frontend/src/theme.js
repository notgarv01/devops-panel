export const colors = {
  onyx: '#0F0F0F',
  trueBlack: '#000000',
  glass: 'rgba(255, 255, 255, 0.05)',
  glassBorder: 'rgba(255, 255, 255, 0.1)',
  neonBlue: '#00D4FF',
  neonPurple: '#7B61FF',
  success: '#00FF88',
  error: '#FF4757',
  warning: '#FFB800',
};

export const glassStyle = {
  background: 'rgba(26, 26, 26, 0.8)',
  backdropFilter: 'blur(20px)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
};

export const glowEffect = (color = colors.neonBlue, intensity = 0.3) => ({
  boxShadow: `0 0 20px ${color}${Math.round(intensity * 255).toString(16).padStart(2, '0')}`,
});