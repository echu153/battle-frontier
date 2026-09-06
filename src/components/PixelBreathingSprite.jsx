import './PixelBreathingSprite.css'

export default function PixelBreathingSprite({
  src,
  alt = '',
  size = 128,
  flip = false,
  duration = 2.8,
  breathe = true,
  className = '',
  style,
}) {
  if (!src) return null

  return (
    <span
      className={`bf-pixel-breath ${className}`.trim()}
      style={{
        '--bf-sprite-size': `${size}px`,
        '--bf-breath-duration': `${duration}s`,
        ...style,
      }}
    >
      <img
        src={src}
        alt={alt}
        className={`bf-pixel-breath__image${breathe ? ' bf-pixel-breath__image--motion' : ''}`}
        style={{ '--bf-sprite-facing': flip ? -1 : 1 }}
      />
    </span>
  )
}
