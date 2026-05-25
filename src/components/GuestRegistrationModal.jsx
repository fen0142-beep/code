import { useState, useEffect } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import DynamicForm from './DynamicForm'
import { createGuestRegistration, logRegistrationChange } from '../lib/supabase'
import { formatEventDate } from '../lib/eventDetailHelpers'

/**
 * 訪客報名 Modal — 後台「＋ 新增訪客」按鈕觸發
 *
 * Props:
 *   open:      boolean，控制顯示
 *   onClose:   關閉 callback
 *   onSuccess: 報名成功後 callback（父層呼叫 load()）
 *   event:     活動物件（用 name、date_start）
 *   eventId:   活動 ID
 *   fields:    event_fields 陣列
 */
export default function GuestRegistrationModal({ open, onClose, onSuccess, event, eventId, fields }) {
  const [guestName, setGuestName] = useState('')
  const [guestAnswers, setGuestAnswers] = useState({})
  const [guestSaving, setGuestSaving] = useState(false)
  const [guestRegId, setGuestRegId] = useState(null)

  useEffect(() => {
    if (open) {
      setGuestName('')
      setGuestAnswers({})
      setGuestRegId(null)
    }
  }, [open])

  if (!open) return null

  async function handleSubmit(e) {
    e.preventDefault()
    if (!guestName.trim()) return
    setGuestSaving(true)
    const { registrationId, error } = await createGuestRegistration(eventId, guestName.trim(), guestAnswers)
    setGuestSaving(false)
    if (error) { alert(`新增失敗：${error}`); return }
    setGuestRegId(registrationId)
    await logRegistrationChange({
      registrationId,
      eventId,
      eventName: event.name,
      studentName: guestName.trim(),
      changeType: 'created',
      oldAnswers: null,
      newAnswers: { guest_name: guestName.trim(), ...guestAnswers },
    })
    onSuccess?.()
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6">
        {guestRegId ? (
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
            <div className="text-center">
              <div className="text-3xl mb-2">✅</div>
              <p className="text-sm text-gray-400 mb-4">截圖或列印後交給訪客，報到時掃描即可</p>
              <div className="qr-print-card border-2 border-gray-200 rounded-xl p-5 mb-4 bg-white">
                <p className="text-sm font-semibold text-gray-400 tracking-widest mb-3">普宜精舍</p>
                <div className="flex justify-center mb-4">
                  <QRCodeSVG value={guestRegId} size={160} />
                </div>
                <p className="text-2xl font-bold text-gray-800 mb-1">{guestName}</p>
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
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <h3 className="text-lg font-bold text-gray-800 mb-4">新增訪客報名</h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-600 mb-1">
                姓名 <span className="text-red-500">*</span>
              </label>
              <input
                required
                value={guestName}
                onChange={e => setGuestName(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                placeholder="請輸入姓名"
              />
            </div>
            {fields.length > 0 && (
              <div className="mb-4">
                <DynamicForm fields={fields} answers={guestAnswers} onChange={setGuestAnswers} />
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 border border-gray-300 text-gray-600 hover:bg-gray-50 font-medium py-2.5 rounded-xl transition-colors"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={guestSaving}
                className="flex-1 bg-amber-700 hover:bg-amber-800 text-white font-medium py-2.5 rounded-xl transition-colors disabled:opacity-50"
              >
                {guestSaving ? '新增中…' : '確認報名'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
