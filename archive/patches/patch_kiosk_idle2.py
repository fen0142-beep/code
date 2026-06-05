#!/usr/bin/env python3
"""Patch: update kiosk idle screen - white card + gold avatar + redesigned buttons"""

filepath = r'src/pages/KioskPage.jsx'

with open(filepath, 'r', encoding='utf-8') as f:
    src = f.read()

old_block = """    <div className="text-center select-none">
      {/* 學員證插圖 */}
      <div className="mb-6 flex justify-center">
        <svg width="260" viewBox="0 0 290 200" xmlns="http://www.w3.org/2000/svg" style={{filter:'drop-shadow(0 4px 12px rgba(0,0,0,0.18))'}}>
          <defs>
            <style>{`
              .ks{animation:kscan 2.2s ease-in-out infinite;}
              @keyframes kscan{
                0%{transform:translateY(0);opacity:1}
                45%{transform:translateY(120px);opacity:1}
                50%{transform:translateY(120px);opacity:0}
                52%{transform:translateY(0);opacity:0}
                57%{opacity:1}
                100%{transform:translateY(0);opacity:1}
              }
              .kc{animation:kblink 2.2s ease-in-out infinite;}
              @keyframes kblink{0%,100%{opacity:1}50%{opacity:0.4}}
            `}</style>
            <clipPath id="kcc"><rect x="0" y="0" width="290" height="200" rx="12"/></clipPath>
          </defs>
          {/* 卡片本體 */}
          <rect x="0" y="0" width="290" height="200" rx="12" fill="#2E0E1F" stroke="#C9A96E" strokeWidth="2"/>
          {/* 金色色帶 */}
          <rect x="0" y="0" width="290" height="34" rx="12" fill="#C9A96E" clipPath="url(#kcc)"/>
          <rect x="0" y="22" width="290" height="12" fill="#C9A96E"/>
          <text x="145" y="23" textAnchor="middle" fontFamily="sans-serif" fontSize="12" fill="#2E0E1F" fontWeight="700" letterSpacing="1">週四夜間　四夜研經三</text>
          {/* 頭像框 */}
          <rect x="14" y="48" width="54" height="62" rx="6" fill="#4A1A32" stroke="#C9A96E" strokeWidth="1"/>
          <circle cx="41" cy="66" r="12" fill="#3D1429"/>
          <ellipse cx="41" cy="88" rx="18" ry="14" fill="#3D1429"/>
          {/* 姓名 */}
          <text x="82" y="68" fontFamily="sans-serif" fontSize="16" fontWeight="700" fill="#F0E8D8">郝發心</text>
          <text x="82" y="86" fontFamily="sans-serif" fontSize="12" fill="#C9A96E">女 1 組</text>
          <text x="82" y="101" fontFamily="sans-serif" fontSize="11" fill="#B0A898">105018687</text>
          {/* QR code */}
          <g transform="translate(160,46)">
            <rect x="0" y="0" width="62" height="62" rx="4" fill="white"/>
            <rect x="5" y="5" width="18" height="18" rx="2" fill="none" stroke="#2E0E1F" strokeWidth="2.5"/>
            <rect x="9" y="9" width="10" height="10" rx="1" fill="#2E0E1F"/>
            <rect x="39" y="5" width="18" height="18" rx="2" fill="none" stroke="#2E0E1F" strokeWidth="2.5"/>
            <rect x="43" y="9" width="10" height="10" rx="1" fill="#2E0E1F"/>
            <rect x="5" y="39" width="18" height="18" rx="2" fill="none" stroke="#2E0E1F" strokeWidth="2.5"/>
            <rect x="9" y="43" width="10" height="10" rx="1" fill="#2E0E1F"/>
            <rect x="29" y="29" width="4" height="4" fill="#2E0E1F"/>
            <rect x="35" y="29" width="4" height="4" fill="#2E0E1F"/>
            <rect x="41" y="29" width="4" height="4" fill="#2E0E1F"/>
            <rect x="47" y="29" width="4" height="4" fill="#2E0E1F"/>
            <rect x="53" y="29" width="4" height="4" fill="#2E0E1F"/>
            <rect x="29" y="35" width="4" height="4" fill="#2E0E1F"/>
            <rect x="41" y="35" width="4" height="4" fill="#2E0E1F"/>
            <rect x="53" y="35" width="4" height="4" fill="#2E0E1F"/>
            <rect x="29" y="41" width="4" height="4" fill="#2E0E1F"/>
            <rect x="41" y="41" width="4" height="4" fill="#2E0E1F"/>
            <rect x="47" y="41" width="4" height="4" fill="#2E0E1F"/>
            <rect x="29" y="47" width="4" height="4" fill="#2E0E1F"/>
            <rect x="41" y="47" width="4" height="4" fill="#2E0E1F"/>
            <rect x="53" y="47" width="4" height="4" fill="#2E0E1F"/>
            <rect x="35" y="53" width="4" height="4" fill="#2E0E1F"/>
            <rect x="47" y="53" width="4" height="4" fill="#2E0E1F"/>
          </g>
          {/* 精舍名 */}
          <text x="145" y="183" textAnchor="middle" fontFamily="sans-serif" fontSize="12" fill="#C9A96E" letterSpacing="3">普宜精舍</text>
          {/* 掃描光線 */}
          <g className="ks" style={{transformOrigin:'145px 4px'}}>
            <rect x="-4" y="4" width="298" height="2.5" rx="1.5" fill="#C9A96E" opacity="0.95"/>
            <rect x="-4" y="0" width="298" height="10" rx="2" fill="#C9A96E" opacity="0.12"/>
          </g>
          {/* 四角掃描框 */}
          <g className="kc" stroke="#C9A96E" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none">
            <path d="M-20 -2 L-20 -14 L-8 -14"/>
            <path d="M310 -2 L310 -14 L298 -14"/>
            <path d="M-20 202 L-20 214 L-8 214"/>
            <path d="M310 202 L310 214 L298 214"/>
          </g>
        </svg>
      </div>
      <p className="text-kiosk-2xl font-bold text-gray-700 mb-2">請刷學員證</p>
      <p className="text-kiosk-base text-gray-500 mb-6">將學員證 QR Code 對準掃描機</p>

      <div className="flex flex-col items-center gap-3 w-full max-w-xs mx-auto">
        <button
          onClick={onOpenCamera}
          className="flex items-center gap-4 w-full px-6 py-4 rounded-2xl font-semibold shadow-sm active:scale-95 transition-transform"
          style={{backgroundColor:'#2E0E1F', border:'2px solid #C9A96E', color:'#C9A96E'}}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
            <circle cx="12" cy="13" r="4"/>
          </svg>
          <span className="text-kiosk-base">用手機相機掃描</span>
        </button>

        <button
          onClick={() => { setImgError(''); fileInputRef.current?.click() }}
          disabled={scanning}
          className="flex items-center gap-4 w-full px-6 py-4 rounded-2xl font-semibold shadow-sm active:scale-95 transition-transform disabled:opacity-50"
          style={{backgroundColor:'#2E0E1F', border:'2px solid #C9A96E', color:'#C9A96E'}}
        >
          {scanning ? (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
            </svg>
          ) : (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <path d="M21 15l-5-5L5 21"/>
            </svg>
          )}
          <span className="text-kiosk-base leading-snug text-left">
            {scanning ? '辨識中…' : <><span>從手機相簿</span><br /><span>選取 QR Code</span></>}
          </span>
        </button>"""

new_block = """    <div className="text-center select-none">
      {/* 學員證插圖（白底金色版） */}
      <div className="mb-6 flex justify-center">
        <svg width="260" viewBox="0 0 290 196" xmlns="http://www.w3.org/2000/svg" style={{filter:'drop-shadow(0 4px 16px rgba(46,14,31,0.18))'}}>
          <defs>
            <style>{`
              .ks{animation:kscan 2.2s ease-in-out infinite;}
              @keyframes kscan{
                0%{transform:translateY(0);opacity:1}
                45%{transform:translateY(118px);opacity:1}
                50%{transform:translateY(118px);opacity:0}
                52%{transform:translateY(0);opacity:0}
                57%{opacity:1}
                100%{transform:translateY(0);opacity:1}
              }
              .kc{animation:kblink 2.2s ease-in-out infinite;}
              @keyframes kblink{0%,100%{opacity:1}50%{opacity:0.4}}
            `}</style>
            <clipPath id="kcc"><rect x="0" y="0" width="290" height="196" rx="12"/></clipPath>
          </defs>
          {/* 白底卡片 */}
          <rect x="0" y="0" width="290" height="196" rx="12" fill="white" stroke="#C9A96E" strokeWidth="2"/>
          {/* 頂部金色色帶 */}
          <rect x="0" y="0" width="290" height="32" rx="12" fill="#C9A96E" clipPath="url(#kcc)"/>
          <rect x="0" y="20" width="290" height="12" fill="#C9A96E"/>
          <text x="145" y="21" textAnchor="middle" fontFamily="sans-serif" fontSize="12" fill="#2E0E1F" fontWeight="700" letterSpacing="1">週四夜間　四夜研經三</text>
          {/* 頭像框（金色系） */}
          <rect x="14" y="46" width="54" height="64" rx="6" fill="#E8D5A8" stroke="#C9A96E" strokeWidth="1.5"/>
          <circle cx="41" cy="64" r="12" fill="#C9A96E"/>
          <ellipse cx="41" cy="86" rx="18" ry="14" fill="#C9A96E"/>
          {/* 姓名 */}
          <text x="82" y="66" fontFamily="sans-serif" fontSize="16" fontWeight="700" fill="#2E0E1F">郝發心</text>
          <text x="82" y="84" fontFamily="sans-serif" fontSize="12" fill="#5a3a4a">女 1 組</text>
          <text x="82" y="99" fontFamily="sans-serif" fontSize="11" fill="#8a7a8a">105018687</text>
          {/* QR code */}
          <g transform="translate(160,44)">
            <rect x="0" y="0" width="62" height="62" rx="4" fill="white" stroke="#C9A96E" strokeWidth="1"/>
            <rect x="5" y="5" width="18" height="18" rx="2" fill="none" stroke="#2E0E1F" strokeWidth="2.5"/>
            <rect x="9" y="9" width="10" height="10" rx="1" fill="#2E0E1F"/>
            <rect x="39" y="5" width="18" height="18" rx="2" fill="none" stroke="#2E0E1F" strokeWidth="2.5"/>
            <rect x="43" y="9" width="10" height="10" rx="1" fill="#2E0E1F"/>
            <rect x="5" y="39" width="18" height="18" rx="2" fill="none" stroke="#2E0E1F" strokeWidth="2.5"/>
            <rect x="9" y="43" width="10" height="10" rx="1" fill="#2E0E1F"/>
            <rect x="29" y="29" width="4" height="4" fill="#2E0E1F"/>
            <rect x="35" y="29" width="4" height="4" fill="#2E0E1F"/>
            <rect x="41" y="29" width="4" height="4" fill="#2E0E1F"/>
            <rect x="47" y="29" width="4" height="4" fill="#2E0E1F"/>
            <rect x="53" y="29" width="4" height="4" fill="#2E0E1F"/>
            <rect x="29" y="35" width="4" height="4" fill="#2E0E1F"/>
            <rect x="41" y="35" width="4" height="4" fill="#2E0E1F"/>
            <rect x="53" y="35" width="4" height="4" fill="#2E0E1F"/>
            <rect x="29" y="41" width="4" height="4" fill="#2E0E1F"/>
            <rect x="41" y="41" width="4" height="4" fill="#2E0E1F"/>
            <rect x="47" y="41" width="4" height="4" fill="#2E0E1F"/>
            <rect x="29" y="47" width="4" height="4" fill="#2E0E1F"/>
            <rect x="41" y="47" width="4" height="4" fill="#2E0E1F"/>
            <rect x="53" y="47" width="4" height="4" fill="#2E0E1F"/>
            <rect x="35" y="53" width="4" height="4" fill="#2E0E1F"/>
            <rect x="47" y="53" width="4" height="4" fill="#2E0E1F"/>
          </g>
          {/* 底部精舍名 */}
          <text x="145" y="180" textAnchor="middle" fontFamily="sans-serif" fontSize="12" fill="#C9A96E" letterSpacing="3">普宜精舍</text>
          {/* 底部金色線 */}
          <rect x="0" y="186" width="290" height="10" fill="#C9A96E" clipPath="url(#kcc)"/>
          {/* 掃描光線 */}
          <g className="ks" style={{transformOrigin:'145px 4px'}}>
            <rect x="-4" y="4" width="298" height="2.5" rx="1.5" fill="#C9A96E" opacity="0.9"/>
            <rect x="-4" y="0" width="298" height="10" rx="2" fill="#C9A96E" opacity="0.12"/>
          </g>
          {/* 四角掃描框 */}
          <g className="kc" stroke="#C9A96E" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none">
            <path d="M-18 -2 L-18 -13 L-7 -13"/>
            <path d="M308 -2 L308 -13 L297 -13"/>
            <path d="M-18 198 L-18 209 L-7 209"/>
            <path d="M308 198 L308 209 L297 209"/>
          </g>
        </svg>
      </div>
      <p className="text-kiosk-2xl font-bold text-gray-700 mb-2">請刷學員證</p>
      <p className="text-kiosk-base text-gray-500 mb-6">將學員證 QR Code 對準掃描機</p>

      <div className="flex flex-col items-center gap-3 w-full max-w-xs mx-auto">
        <button
          onClick={onOpenCamera}
          className="flex items-center gap-4 w-full px-6 py-4 rounded-2xl font-semibold shadow-sm active:scale-95 transition-transform"
          style={{backgroundColor:'#2E0E1F', border:'2px solid #C9A96E', color:'#C9A96E'}}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
            <circle cx="12" cy="13" r="4"/>
          </svg>
          <span className="text-kiosk-base">用手機相機掃描</span>
        </button>

        <button
          onClick={() => { setImgError(''); fileInputRef.current?.click() }}
          disabled={scanning}
          className="flex items-center gap-4 w-full px-6 py-4 rounded-2xl font-semibold shadow-sm active:scale-95 transition-transform disabled:opacity-50"
          style={{backgroundColor:'white', border:'2px solid #C9A96E', color:'#2E0E1F'}}
        >
          {scanning ? (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2E0E1F" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
            </svg>
          ) : (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2E0E1F" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <path d="M21 15l-5-5L5 21"/>
            </svg>
          )}
          <span className="text-kiosk-base leading-snug text-left">
            {scanning ? '辨識中…' : <><span>從手機相簿</span><br /><span>選取 QR Code</span></>}
          </span>
        </button>"""

assert old_block in src, "FAIL: idle block not found"
src = src.replace(old_block, new_block, 1)

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(src)

print(f"✅ Done. Lines: {src.count(chr(10))}")
for kw in ['E8D5A8', 'white', 'C9A96E', '普宜精舍']:
    assert kw in src, f"MISSING: {kw}"
    print(f"  ✓ {kw}")
