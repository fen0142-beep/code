export default function ScanToast({ msg }) {
  if (!msg) return null
  const isOk = msg.startsWith('✓')
  return (
    <div
      className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl text-sm font-semibold shadow-lg border whitespace-nowrap ${
        isOk
          ? 'bg-green-100 text-green-800 border-green-300'
          : 'bg-red-100 text-red-700 border-red-300'
      }`}
    >
      {msg}
    </div>
  )
}
