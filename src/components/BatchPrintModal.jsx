import { QRCodeSVG } from 'qrcode.react'
import { getDisplayName, formatEventDate } from '../lib/eventDetailHelpers'

/**
 * 批次列印訪客通行證 Modal — 勾選訪客後點「🖨️ 批次列印」觸發
 *
 * Props:
 *   open:             boolean，控制顯示
 *   onClose:          關閉 callback
 *   event:            活動物件（用 name、date_start）
 *   selectedGuestRegs: 已勾選的訪客報名物件陣列
 */
export default function BatchPrintModal({ open, onClose, event, selectedGuestRegs }) {
  if (!open) return null

  return (
    <>
      <style>{`
        @page { size: A4 portrait; margin: 2mm; }
        @media print {
          body * { visibility: hidden !important; }
          .batch-print-cards, .batch-print-cards * { visibility: visible !important; }
          .batch-print-overlay {
            position: static !important;
            background: transparent !important;
            overflow: visible !important;
            display: block !important;
            height: auto !important;
          }
          .batch-print-toolbar { display: none !important; }
          .batch-print-preview {
            overflow: visible !important;
            padding: 0 !important;
            flex: none !important;
          }
          .batch-print-cards {
            display: grid !important;
            grid-template-columns: repeat(4, 1fr) !important;
            gap: 2mm !important;
            max-width: none !important;
            margin: 0 !important;
            width: 100% !important;
          }
          .batch-print-card {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }
        }
      `}</style>
      <div className="batch-print-overlay fixed inset-0 z-50 flex flex-col bg-gray-100">
        {/* 頂部工具列 */}
        <div className="batch-print-toolbar bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4 shrink-0 shadow-sm">
          <div>
            <h3 className="text-base font-bold text-gray-800">批次列印訪客通行證</h3>
            <p className="text-xs text-gray-400">共 {selectedGuestRegs.length} 張・一列 4 張・列印後沿虛線剪開，每人一張</p>
          </div>
          <div className="ml-auto flex gap-3">
            <button
              onClick={() => window.print()}
              className="bg-amber-700 hover:bg-amber-800 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
            >
              🖨️ 列印
            </button>
            <button
              onClick={onClose}
              className="border border-gray-300 text-gray-600 hover:bg-gray-50 text-sm font-medium px-5 py-2 rounded-lg transition-colors"
            >
              關閉
            </button>
          </div>
        </div>

        {/* 卡片預覽區 */}
        <div className="batch-print-preview flex-1 overflow-auto p-3">
          <div
            className="batch-print-cards"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px', maxWidth: '880px', margin: '0 auto' }}
          >
            {selectedGuestRegs.map(r => (
              <div
                key={r.registration_id}
                className="batch-print-card"
                style={{
                  border: '1px dashed #d1d5db',
                  borderRadius: '6px',
                  padding: '8px 8px',
                  textAlign: 'center',
                  background: 'white',
                  breakInside: 'avoid',
                  pageBreakInside: 'avoid',
                }}
              >
                <p style={{ fontSize: '8px', color: '#9ca3af', letterSpacing: '2px', marginBottom: '4px', fontWeight: '600' }}>
                  普宜精舍
                </p>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '5px' }}>
                  <QRCodeSVG value={r.registration_id} size={110} />
                </div>
                <p style={{ fontSize: '13px', fontWeight: 'bold', color: '#1f2937', margin: '0 0 2px' }}>
                  {getDisplayName(r)}
                </p>
                <p style={{ fontSize: '10px', color: '#4b5563', margin: '0 0 1px' }}>{event.name}</p>
                {event.date_start && (
                  <p style={{ fontSize: '9px', color: '#6b7280', margin: 0 }}>{formatEventDate(event)}</p>
                )}
                <p style={{ fontSize: '7px', color: '#d1d5db', marginTop: '4px' }}>
                  掃描此 QR code 即可報到
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
