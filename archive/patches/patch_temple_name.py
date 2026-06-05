#!/usr/bin/env python3
"""Patch: replace hardcoded '普宜精舍' with VITE_TEMPLE_NAME env var across src files"""

import os

BASE = 'src'
TEMPLE = 'import.meta.env.VITE_TEMPLE_NAME'

def patch(filepath, replacements):
    with open(filepath, encoding='utf-8') as f:
        src = f.read()
    for old, new in replacements:
        assert old in src, f"FAIL in {filepath}: not found: {repr(old[:60])}"
        src = src.replace(old, new, 1)
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(src)
    print(f"✓ {filepath}")

# ── KioskPage.jsx ─────────────────────────────────────────────────────────────
patch('src/pages/KioskPage.jsx', [
    # Header top display
    (
        "<p className=\"text-kiosk-sm\" style={{ color: '#C9A96E', opacity: 0.85 }}>普宜精舍</p>",
        "<p className=\"text-kiosk-sm\" style={{ color: '#C9A96E', opacity: 0.85 }}>{import.meta.env.VITE_TEMPLE_NAME}</p>",
    ),
    # SVG card illustration
    (
        ">普宜精舍</text>",
        ">{import.meta.env.VITE_TEMPLE_NAME}</text>",
    ),
    # Printed card canvas
    (
        "ctx.fillText('普宜精舍　學員證', W / 2, 48)",
        "ctx.fillText(`${import.meta.env.VITE_TEMPLE_NAME}　學員證`, W / 2, 48)",
    ),
])

# ── AdminLayout.jsx ───────────────────────────────────────────────────────────
patch('src/components/AdminLayout.jsx', [
    (
        ">普宜精舍 · 後台</span>",
        ">{import.meta.env.VITE_TEMPLE_NAME} · 後台</span>",
    ),
])

# ── LoginPage.jsx ─────────────────────────────────────────────────────────────
patch('src/pages/admin/LoginPage.jsx', [
    (
        ">普宜精舍</h1>",
        ">{import.meta.env.VITE_TEMPLE_NAME}</h1>",
    ),
])

# ── ActivitiesPage.jsx (front page hero) ─────────────────────────────────────
patch('src/pages/ActivitiesPage.jsx', [
    (
        "            普宜精舍\n",
        "            {import.meta.env.VITE_TEMPLE_NAME}\n",
    ),
])

# ── BatchPrintModal.jsx ───────────────────────────────────────────────────────
patch('src/components/BatchPrintModal.jsx', [
    (
        "                  普宜精舍\n",
        "                  {import.meta.env.VITE_TEMPLE_NAME}\n",
    ),
])

# ── GuestRegistrationModal.jsx ────────────────────────────────────────────────
patch('src/components/GuestRegistrationModal.jsx', [
    (
        ">普宜精舍</p>",
        ">{import.meta.env.VITE_TEMPLE_NAME}</p>",
    ),
])

# ── QrCodeModal.jsx ───────────────────────────────────────────────────────────
patch('src/components/QrCodeModal.jsx', [
    (
        ">普宜精舍</p>",
        ">{import.meta.env.VITE_TEMPLE_NAME}</p>",
    ),
])

# ── EventsPage.jsx (export filename + _source) ───────────────────────────────
patch('src/pages/admin/EventsPage.jsx', [
    (
        "_source: '普宜精舍',",
        "_source: import.meta.env.VITE_TEMPLE_NAME,",
    ),
    (
        "a.download = `活動模板_普宜精舍_${today}.json`",
        "a.download = `活動模板_${import.meta.env.VITE_TEMPLE_NAME}_${today}.json`",
    ),
])

print("\n✅ All patches done.")
