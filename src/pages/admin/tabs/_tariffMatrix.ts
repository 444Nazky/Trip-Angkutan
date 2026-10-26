import { useState } from 'react'
import type { VehicleType } from './TariffTab'

export interface MatrixCell {
  lokal: number
  externalMuatan: number
  externalKosong: number
}

export interface MatrixRow {
  vt: VehicleType
  cells: MatrixCell
}

export type MatrixRowEditor =
  | { mode: 'view' }
  | { mode: 'edit'; vt: VehicleType; lokal: string; externalMuatan: string; externalKosong: string }

export interface EditableMatrixState {
  rows: MatrixRow[]
  editing: Record<VehicleType, MatrixRowEditor>
  adding: VehicleType | null
  addForm: { vt: VehicleType; lokal: string; externalMuatan: string; externalKosong: string }
}

export function createEditableMatrixState(initialRows: MatrixRow[], placeholder: boolean): EditableMatrixState {
  const rows = initialRows.map((row) => ({
    ...row,
    cells: {
      lokal: placeholder ? 0 : row.cells.lokal,
      externalMuatan: placeholder ? 0 : row.cells.externalMuatan,
      externalKosong: placeholder ? 0 : row.cells.externalKosong,
    },
  }))
  return {
    rows,
    editing: {} as Record<VehicleType, MatrixRowEditor>,
    adding: null,
    addForm: { vt: 'motor', lokal: '', externalMuatan: '', externalKosong: '' },
  }
}

export function makeInitialMatrixRow(vt: VehicleType, placeholder: boolean): MatrixRow {
  return {
    vt,
    cells: {
      lokal: 0,
      externalMuatan: 0,
      externalKosong: 0,
    },
  }
}

export function guessVehicleTypeFromLabel(label: string): VehicleType | null {
  const normalized = label.trim().toLowerCase()
  const map: Record<string, VehicleType> = {
    motor: 'motor',
    mobil: 'mobil',
    'truk kecil': 'truk kecil',
    'truk sedang': 'truk sedang',
    'truk besar': 'truk besar',
  }
  return map[normalized] ?? null
}

export function cellInputClass(): string {
  return 'w-full border border-slate-300 rounded-lg px-2 py-1 text-center text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500/60'
}

export function startAdd(state: EditableMatrixState, vt: VehicleType): EditableMatrixState {
  return {
    ...state,
    adding: vt,
    addForm: { vt, lokal: '', externalMuatan: '', externalKosong: '' },
  }
}

export function cancelAdd(state: EditableMatrixState): EditableMatrixState {
  return { ...state, adding: null }
}

export function updateAddForm(state: EditableMatrixState, field: keyof typeof state.addForm, value: string): EditableMatrixState {
  return { ...state, addForm: { ...state.addForm, [field]: value } }
}

export function commitAdd(state: EditableMatrixState): MatrixRow | null {
  const { vt, lokal, externalMuatan, externalKosong } = state.addForm
  const l = parseInt(lokal, 10)
  const em = parseInt(externalMuatan, 10)
  const ek = parseInt(externalKosong, 10)
  if (!(l >= 0) || !(em >= 0) || !(ek >= 0)) return null
  return {
    vt,
    cells: { lokal: l, externalMuatan: em, externalKosong: ek },
  }
}

export function startEdit(state: EditableMatrixState, row: MatrixRow): EditableMatrixState {
  return {
    ...state,
    editing: {
      ...state.editing,
      [row.vt]: {
        mode: 'edit',
        vt: row.vt,
        lokal: String(row.cells.lokal),
        externalMuatan: String(row.cells.externalMuatan),
        externalKosong: String(row.cells.externalKosong),
      },
    },
  }
}

export function cancelEdit(state: EditableMatrixState): EditableMatrixState {
  const next = { ...state.editing }
  for (const key of Object.keys(next)) {
    delete next[key as VehicleType]
  }
  return { ...state, editing: next }
}

export function updateEditForm(state: EditableMatrixState, vt: VehicleType, field: keyof Pick<MatrixRowEditor, 'lokal' | 'externalMuatan' | 'externalKosong'>, value: string): EditableMatrixState {
  const cur = state.editing[vt]
  if (cur.mode !== 'edit') return state
  return {
    ...state,
    editing: {
      ...state.editing,
      [vt]: { ...cur, [field]: value },
    },
  }
}

export function commitEdit(state: EditableMatrixState, vt: VehicleType): MatrixRow | null {
  const ed = state.editing[vt]
  if (ed.mode !== 'edit') return null
  const l = parseInt(ed.lokal, 10)
  const em = parseInt(ed.externalMuatan, 10)
  const ek = parseInt(ed.externalKosong, 10)
  if (!(l >= 0) || !(em >= 0) || !(ek >= 0)) return null
  return {
    vt,
    cells: { lokal: l, externalMuatan: em, externalKosong: ek },
  }
}

export function removeRow(state: EditableMatrixState, vt: VehicleType): EditableMatrixState {
  return {
    ...state,
    rows: state.rows.filter((r) => r.vt !== vt),
  }
}
