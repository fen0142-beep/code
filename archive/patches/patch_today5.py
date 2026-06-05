# -*- coding: utf-8 -*-
# 補丁 #5 — 2026-05-22 五度
#
# 1. 義工車 button 文字按實際身分別：義工→「義工」、信眾→「自行」
# 2. 義工車/延後車/提前車展開時保留 border-l-4 強調線（顏色依車況）

from pathlib import Path

ROOT = Path(__file__).parent
CH = ROOT / 'src/pages/CarCheckinPage.jsx'


def replace_once(text, old, new, label):
    cnt = text.count(old)
    if cnt == 0:
        print(f'[SKIP] {label}: 找不到 old_string')
        return text
    if cnt > 1:
        raise RuntimeError(f'[ERROR] {label}: old_string 出現 {cnt} 次')
    print(f'[OK]   {label}')
    return text.replace(old, new, 1)


ch = CH.read_text(encoding='utf-8')

# ─── A. mode='head' 小車展開：cardBg 改成保留 border-l-4 ──
old_a = '''                    const cardBg = integratedExcluded
                      ? (headDirection === 'down' ? 'bg-amber-50' : 'bg-teal-50')
                      : (innerExp ? 'bg-emerald-50 border-l-4 border-emerald-500' : 'bg-gray-50')'''

new_a = '''                    // 背景色：依車況；展開時加 border-l-4 強調線（顏色依車況）
                    const cardBaseBg = integratedExcluded
                      ? (headDirection === 'down' ? 'bg-amber-50' : 'bg-teal-50')
                      : (innerExp ? 'bg-emerald-50' : 'bg-gray-50')
                    const cardBorderL = innerExp
                      ? (integratedExcluded
                        ? (headDirection === 'down' ? 'border-l-4 border-amber-500' : 'border-l-4 border-teal-500')
                        : 'border-l-4 border-emerald-500')
                      : ''
                    const cardBg = `${cardBaseBg} ${cardBorderL}`.trim()'''

ch = replace_once(ch, old_a, new_a, 'A: mode=head 小車展開 cardBg 加 border-l-4')

# ─── B. mode='head' 小車展開 button 文字按身分別 ──
old_b = '''                                    {memberExcluded ? (volSelfReturn ? '義工' : headDirection === 'down' ? '延後' : '提前') : chk ? '已到' : '報到'}'''

new_b = '''                                    {memberExcluded
                                      ? (volSelfReturn
                                        ? (member.registrations?.answers?.identity === '義工' ? '義工' : '自行')
                                        : headDirection === 'down' ? '延後' : '提前')
                                      : chk ? '已到' : '報到'}'''

ch = replace_once(ch, old_b, new_b, 'B: mode=head 小車展開 button 文字按身分別')

# ─── C. mode='small_car' button 文字按身分別 ──
old_c = '''                          {memberExcluded ? (volSelfReturn ? '義工' : dir === 'down' ? '延後' : '提前') : chk ? '已到' : '報到'}'''

new_c = '''                          {memberExcluded
                            ? (volSelfReturn
                              ? (member.registrations?.answers?.identity === '義工' ? '義工' : '自行')
                              : dir === 'down' ? '延後' : '提前')
                            : chk ? '已到' : '報到'}'''

ch = replace_once(ch, old_c, new_c, 'C: mode=small_car button 文字按身分別')

CH.write_text(ch, encoding='utf-8')
print(f'[WROTE] {CH} ({len(ch)} bytes)')
