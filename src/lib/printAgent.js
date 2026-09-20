// 封裝 fetch 呼叫本地印表代理程式（print-agent）的邏輯
// 代理程式沒開/印表機沒開都要靜默失敗，絕不能擋報到流程

const PRINT_AGENT_URL = 'http://127.0.0.1:9789/print'
const TIMEOUT_MS = 4000

// donor: 功德主紀錄物件（answers: {field_key: value}），可為 null
// donorFields: 該活動的功德主動態欄位設定（有序，[{field_key, field_label}]）
// eventName: 活動全名（例如「普宜精舍金剛經共修法會暨護法會頒證大典」），印在小單副標
export async function printDonorTicket({ name, donor, donorFields, eventName, copies = 1 } = {}) {
  // 只有功德主才需要出單；不是功德主（donor 為 null）直接跳過，
  // 避免代理程式對每一個報到的人都送出只有姓名的空白小單
  if (!donor) return { success: false, skipped: true }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    // 依 event_donor_fields 順序把 answers 轉成 [{label, value}]，空值不送
    const fields = (donorFields || [])
      .map(f => ({ label: f.field_label, value: donor?.answers?.[f.field_key] ?? '' }))
      .filter(f => f.value && String(f.value).trim())

    const res = await fetch(PRINT_AGENT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name ?? '',
        fields,
        eventName: eventName ?? '',
        copies,
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      console.warn('[printAgent] 列印失敗', res.status)
      return { success: false }
    }
    return { success: true }
  } catch (err) {
    console.warn('[printAgent] 印表代理程式無回應，略過列印', err.message)
    return { success: false }
  } finally {
    clearTimeout(timer)
  }
}

export default { printDonorTicket }
