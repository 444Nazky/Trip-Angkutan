import { describe, expect, it } from 'vitest'
import {
  boxToSource,
  decodeYoloOutput,
  iou,
  letterboxParams,
  nonMaxSuppression,
  type PlateBox,
} from './alpr'

function box(x1: number, y1: number, x2: number, y2: number, score = 0.9): PlateBox {
  return { x1, y1, x2, y2, score }
}

describe('decodeYoloOutput', () => {
  it('membaca keluaran channels-first [1, 5, N]', () => {
    // 2 anchor: satu plat valid (cx=100, cy=50, w=40, h=20, skor 0.8), satu di bawah ambang.
    const n = 2
    const data = new Float32Array(5 * n)
    const set = (c: number, i: number, v: number) => { data[c * n + i] = v }
    set(0, 0, 100); set(1, 0, 50); set(2, 0, 40); set(3, 0, 20); set(4, 0, 0.8)
    set(0, 1, 10); set(1, 1, 10); set(2, 1, 5); set(3, 1, 5); set(4, 1, 0.1)

    const boxes = decodeYoloOutput(data, [1, 5, n])
    expect(boxes).toHaveLength(1)
    expect(boxes[0].x1).toBeCloseTo(80)
    expect(boxes[0].y1).toBeCloseTo(40)
    expect(boxes[0].x2).toBeCloseTo(120)
    expect(boxes[0].y2).toBeCloseTo(60)
    expect(boxes[0].score).toBeCloseTo(0.8)
  })

  it('membaca keluaran channels-last [1, N, 5]', () => {
    const n = 100
    const data = new Float32Array(n * 5)
    data.set([100, 50, 40, 20, 0.9, 10, 10, 5, 5, 0.2])
    const boxes = decodeYoloOutput(data, [1, n, 5])
    expect(boxes).toHaveLength(1)
    expect(boxes[0].score).toBeCloseTo(0.9)
  })

  it('mengabaikan kotak dengan lebar/tinggi nol', () => {
    const data = new Float32Array([10, 10, 0, 10, 0.9])
    expect(decodeYoloOutput(data, [1, 5, 1])).toHaveLength(0)
  })
})

describe('nonMaxSuppression', () => {
  it('menyisakan kotak skor tertinggi dari dua kotak yang tumpang tindih', () => {
    const kept = nonMaxSuppression([box(0, 0, 100, 100, 0.5), box(5, 5, 105, 105, 0.9)])
    expect(kept).toHaveLength(1)
    expect(kept[0].score).toBeCloseTo(0.9)
  })

  it('mempertahankan kotak yang terpisah', () => {
    const kept = nonMaxSuppression([box(0, 0, 50, 50), box(200, 200, 260, 260)])
    expect(kept).toHaveLength(2)
  })

  it('iou kotak sama = 1', () => {
    expect(iou(box(0, 0, 10, 10), box(0, 0, 10, 10))).toBeCloseTo(1)
  })
})

describe('letterbox', () => {
  it('menghitung skala & offset untuk gambar lebar', () => {
    const params = letterboxParams(1280, 640)
    expect(params.scale).toBeCloseTo(0.5)
    expect(params.dx).toBe(0)
    expect(params.dy).toBe(160)
  })

  it('mengembalikan kotak ke koordinat gambar asli', () => {
    const params = letterboxParams(1280, 640)
    const source = boxToSource(box(0, 160, 640, 480), params, 1280, 640)
    expect(source.x1).toBeCloseTo(0)
    expect(source.y1).toBeCloseTo(0)
    expect(source.x2).toBeCloseTo(1280)
    expect(source.y2).toBeCloseTo(640)
  })

  it('tidak menghasilkan koordinat di luar gambar', () => {
    const params = letterboxParams(1000, 1000)
    const source = boxToSource(box(-20, -20, 700, 700), params, 1000, 1000)
    expect(source.x1).toBe(0)
    expect(source.y1).toBe(0)
    expect(source.x2).toBeLessThanOrEqual(1000)
    expect(source.y2).toBeLessThanOrEqual(1000)
  })
})
