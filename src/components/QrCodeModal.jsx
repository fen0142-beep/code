import { QRCodeSVG } from 'qrcode.react'
import { formatEventDate } from '../lib/eventDetailHelpers'

/**
 * 補看 QR code Modal（單張）— 名單列訪客欄「訪客 🔍」按鈕觸發
 *
 * Props:
 *   registrationId: string | null，null 時不渲染
 *   name:           顯示姓名
 *   event:          活動物件（用 name、date_start）
 *   onClose:        關閉 callback
 */
export default function QrCodeModal({ registrationId, name, event, onClose }) {
  if (!registrationId) return null

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .qr-print-card, .qr-print-card * { visibility: visible; }
          .qr-print-card {
            position: fixed;
            top: 50%; left: 50%;
            transform: translate(-50%, -50%);
          }
        }
      `}</style>
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center">
          <p className="text-sm text-gray-400 mb-4">截圖或列印後交給訪客，報到時掃描即可</p>
          <div className="qr-print-card border-2 border-gray-200 rounded-xl p-5 mb-4 bg-white">
            <p className="text-sm font-semibold text-gray-400 tracking-widest mb-3">{import.meta.env.VITE_TEMPLE_NAME}</p>
            <div className="flex justify-center mb-4">
              <QRCodeSVG value={registrationId} size={160} />
            </div>
            <p className="text-2xl font-bold text-gray-800 mb-1">{name}</p>
            <p className="text-sm text-gray-600">{event.name}</p>
            {event.date_start && (
              <p className="text-sm text-gray-500 mt-0.5">{formatEventDate(event)}</p>
            )}
            <p className="text-xs text-gray-300 mt-3">掃描此 QR code 即可報到</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => window.print()}
              className="flex-1 border-2 border-amber-400 text-amber-700 hover:bg-amber-50 font-medium py-2.5 rounded-xl transition-colors"
            >
              🖨️ 列印
            </button>
            <button
              onClick={onClose}
              className="flex-1 bg-amber-700 hover:bg-amber-800 text-white font-medium py-2.5 rounded-xl transition-colors"
            >
              關閉
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
