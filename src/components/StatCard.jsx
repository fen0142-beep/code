export default function StatCard({ label, value, color, sub }) {
  return (
    <div className={`border rounded-xl p-4 ${color}`}>
      <div className="text-3xl font-bold">{value}</div>
      <div className="text-xs mt-1">{label}</div>
      {sub && <div className="text-xs mt-0.5 text-purple-600">{sub}</div>}
    </div>
  )
}
