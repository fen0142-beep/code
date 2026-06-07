export default function DirectionBadge({ direction }) {
  if (direction === 'up') {
    return <span className="text-xs bg-blue-100 text-blue-700 border border-blue-200 rounded-full px-1.5 shrink-0">🚌 去程</span>
  }
  if (direction === 'down') {
    return <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200 rounded-full px-1.5 shrink-0">🚍 回程</span>
  }
  return null
}
