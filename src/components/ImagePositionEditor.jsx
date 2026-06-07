import { useState, useRef } from 'react'

export default function ImagePositionEditor({ url, position, onChange }) {
  const [isDragging, setIsDragging] = useState(false)
  const [lastPos, setLastPos] = useState({ x: 0, y: 0 })
  const containerRef = useRef(null)

  const parsePos = (pos) => {
    const [x, y] = (pos || '50% 50%').split(' ').map(v => parseFloat(v))
    return { x: isNaN(x) ? 50 : x, y: isNaN(y) ? 50 : y }
  }

  const handleMouseDown = (e) => {
    e.preventDefault()
    setIsDragging(true)
    setLastPos({ x: e.clientX, y: e.clientY })
  }

  const handleMouseMove = (e) => {
    if (!isDragging) return
    const dx = e.clientX - lastPos.x
    const dy = e.clientY - lastPos.y
    setLastPos({ x: e.clientX, y: e.clientY })
    const { x, y } = parsePos(position)
    const sensitivity = 0.2
    const newX = Math.min(100, Math.max(0, x - dx * sensitivity))
    const newY = Math.min(100, Math.max(0, y - dy * sensitivity))
    onChange(`${Math.round(newX)}% ${Math.round(newY)}%`)
  }

  const handleMouseUp = () => setIsDragging(false)
  const handleMouseLeave = () => setIsDragging(false)

  const handleTouchStart = (e) => {
    const t = e.touches[0]
    setIsDragging(true)
    setLastPos({ x: t.clientX, y: t.clientY })
  }

  const handleTouchMove = (e) => {
    if (!isDragging) return
    const t = e.touches[0]
    const dx = t.clientX - lastPos.x
    const dy = t.clientY - lastPos.y
    setLastPos({ x: t.clientX, y: t.clientY })
    const { x, y } = parsePos(position)
    const sensitivity = 0.2
    const newX = Math.min(100, Math.max(0, x - dx * sensitivity))
    const newY = Math.min(100, Math.max(0, y - dy * sensitivity))
    onChange(`${Math.round(newX)}% ${Math.round(newY)}%`)
  }

  return (
    <div className="mt-3">
      <p className="text-xs text-gray-500 mb-1">圖片顯示位置</p>
      <div
        ref={containerRef}
        style={{
          width: '100%',
          aspectRatio: '5 / 2',
          overflow: 'hidden',
          borderRadius: '6px',
          border: '1px solid #d1d5db',
          cursor: isDragging ? 'grabbing' : 'grab',
          position: 'relative',
          userSelect: 'none',
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleMouseUp}
      >
        <img
          src={url}
          alt="封面預覽"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: position || '50% 50%',
            pointerEvents: 'none',
            draggable: false,
          }}
        />
        <div style={{
          position: 'absolute',
          bottom: '6px',
          right: '8px',
          backgroundColor: 'rgba(0,0,0,0.5)',
          color: 'white',
          fontSize: '0.65rem',
          padding: '2px 6px',
          borderRadius: '3px',
          pointerEvents: 'none',
        }}>
          拖曳圖片調整顯示位置
        </div>
      </div>
      <p className="text-xs text-gray-400 mt-1">目前：{position || '50% 50%'}</p>
    </div>
  )
}
