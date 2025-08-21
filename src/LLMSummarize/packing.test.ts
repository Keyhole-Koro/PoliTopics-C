// src/LLMSummarize/__tests__/packing.fixtures.test.ts
// Tests packing with provided OrderLen fixtures (no cutting). Threshold = 10,000.

import { packIndexSetsByGreedy, type IndexPack } from "./packing";
import type { OrderLen } from "./packing";

const THRESHOLD = 10_000;

/** Project packs to a comparable shape that ignores optional fields (e.g., oversized). */
function normalize(packs: IndexPack[]) {
  return packs.map(p => ({
    indices: p.indices,
    orders: p.orders,
    totalLen: p.totalLen,
  }));
}

describe("packIndexSetsByGreedy fixtures", () => {
  test("fixture #1 packs everything into one set", () => {
    const input: OrderLen[] = [
      { idx: 0, order: 0, len: 243 },
      { idx: 1, order: 1, len: 40 },
      { idx: 2, order: 2, len: 157 },
      { idx: 3, order: 3, len: 50 },
      { idx: 4, order: 4, len: 69 },
      { idx: 5, order: 5, len: 108 },
      { idx: 6, order: 6, len: 61 },
      { idx: 7, order: 7, len: 79 },
      { idx: 8, order: 8, len: 169 },
      { idx: 9, order: 9, len: 405 },
      { idx: 10, order: 10, len: 126 },
      { idx: 11, order: 11, len: 55 },
      { idx: 12, order: 12, len: 180 },
      { idx: 13, order: 13, len: 37 },
    ];

    const expected = [
      {
        indices: [0,1,2,3,4,5,6,7,8,9,10,11,12,13],
        orders:  [0,1,2,3,4,5,6,7,8,9,10,11,12,13],
        totalLen: 1779,
      },
    ];

    const packs = packIndexSetsByGreedy(input, THRESHOLD);
    expect(normalize(packs)).toEqual(expected);
  });

  test("fixture #2 creates multiple packs under threshold", () => {
    const input: OrderLen[] = [
      { idx: 0, order: 0, len: 436 },
      { idx: 1, order: 1, len: 147 },
      { idx: 2, order: 2, len: 984 },
      { idx: 3, order: 3, len: 67 },
      { idx: 4, order: 4, len: 3304 },
      { idx: 5, order: 5, len: 803 },
      { idx: 6, order: 6, len: 213 },
      { idx: 7, order: 7, len: 34 },
      { idx: 8, order: 8, len: 5165 },
      { idx: 9, order: 9, len: 1661 },
      { idx: 10, order: 10, len: 799 },
      { idx: 11, order: 11, len: 404 },
      { idx: 12, order: 12, len: 323 },
      { idx: 13, order: 13, len: 817 },
      { idx: 14, order: 14, len: 34 },
      { idx: 15, order: 15, len: 2923 },
      { idx: 16, order: 16, len: 1334 },
      { idx: 17, order: 17, len: 339 },
      { idx: 18, order: 18, len: 673 },
      { idx: 19, order: 19, len: 32 },
      { idx: 20, order: 20, len: 3052 },
      { idx: 21, order: 21, len: 1405 },
      { idx: 22, order: 22, len: 629 },
      { idx: 23, order: 23, len: 381 },
      { idx: 24, order: 24, len: 791 },
      { idx: 25, order: 25, len: 34 },
      { idx: 26, order: 26, len: 2657 },
      { idx: 27, order: 27, len: 691 },
      { idx: 28, order: 28, len: 691 },
      { idx: 29, order: 29, len: 292 },
      { idx: 30, order: 30, len: 32 },
      { idx: 31, order: 31, len: 2871 },
      { idx: 32, order: 32, len: 584 },
      { idx: 33, order: 33, len: 372 },
      { idx: 34, order: 34, len: 1217 },
      { idx: 35, order: 35, len: 634 },
      { idx: 36, order: 36, len: 501 },
      { idx: 37, order: 37, len: 45 },
      { idx: 38, order: 38, len: 187 },
      { idx: 39, order: 39, len: 357 },
      { idx: 40, order: 40, len: 56 },
      { idx: 41, order: 41, len: 60 },
      { idx: 42, order: 42, len: 143 },
      { idx: 43, order: 43, len: 132 },
      { idx: 44, order: 44, len: 331 },
      { idx: 45, order: 45, len: 62 },
      { idx: 46, order: 46, len: 101 },
      { idx: 47, order: 47, len: 145 },
      { idx: 48, order: 48, len: 101 },
      { idx: 49, order: 49, len: 78 },
      { idx: 50, order: 50, len: 77 },
      { idx: 51, order: 51, len: 94 },
      { idx: 52, order: 52, len: 67 },
      { idx: 53, order: 53, len: 73 },
      { idx: 54, order: 54, len: 225 },
    ];

    const expected = [
      {
        indices: [0,1,2,3,4,5,6,7],
        orders:  [0,1,2,3,4,5,6,7],
        totalLen: 5988,
      },
      {
        indices: [8,9,10,11,12,13,14],
        orders:  [8,9,10,11,12,13,14],
        totalLen: 9203,
      },
      {
        indices: [15,16,17,18,19,20,21],
        orders:  [15,16,17,18,19,20,21],
        totalLen: 9758,
      },
      {
        indices: [22,23,24,25,26,27,28,29,30,31,32],
        orders:  [22,23,24,25,26,27,28,29,30,31,32],
        totalLen: 9653,
      },
      {
        indices: [33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54],
        orders:  [33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54],
        totalLen: 5058,
      },
    ];

    const packs = packIndexSetsByGreedy(input, THRESHOLD);
    expect(normalize(packs)).toEqual(expected);
  });

  test("fixture #3 packs everything into one set", () => {
    const input: OrderLen[] = [
      { idx: 0, order: 0, len: 184 },
      { idx: 1, order: 1, len: 40 },
      { idx: 2, order: 2, len: 133 },
      { idx: 3, order: 3, len: 50 },
      { idx: 4, order: 4, len: 118 },
      { idx: 5, order: 5, len: 232 },
      { idx: 6, order: 6, len: 292 },
      { idx: 7, order: 7, len: 67 },
      { idx: 8, order: 8, len: 56 },
      { idx: 9, order: 9, len: 41 },
    ];

    const expected = [
      {
        indices: [0,1,2,3,4,5,6,7,8,9],
        orders:  [0,1,2,3,4,5,6,7,8,9],
        totalLen: 1213,
      },
    ];

    const packs = packIndexSetsByGreedy(input, THRESHOLD);
    expect(normalize(packs)).toEqual(expected);
  });
});
