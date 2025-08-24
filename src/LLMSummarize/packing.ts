import type { Dialog } from "@interfaces/Article";

export interface OrderLen {
  idx: number;   // index in the dialogs array (0..N-1)
  order: number; // dialog.order
  len: number;   // length of dialog.original_text
};

export interface IndexPack {
  indices: number[];   // indices into the original dialogs array
  orders: number[];    // corresponding dialog.order values (for convenience)
  totalLen: number;    // total length of original_text for this pack
  oversized?: boolean; // true if a single dialog exceeded the threshold (we still keep it as one pack)
};

/** Build a (idx, order, len) table. Keeps original order as given by the array. */
export function buildOrderLen(dialogs: Dialog[]): OrderLen[] {
  return dialogs.map((d, idx) => ({
    idx,
    order: d.order,
    len: d?.original_text?.length ?? 0,
  }));
}

/** 
 * Greedy packer that groups dialogs into index sets whose total len <= charThreshold.
 * - Preserves array order (no reordering)
 * - NEVER cuts original_text
 * - If a single dialog's len > threshold, it becomes a single oversized pack (oversized=true).
 */
export function packIndexSetsByGreedy(orderLenList: OrderLen[], charThreshold: number): IndexPack[] {
  if (!Number.isFinite(charThreshold) || charThreshold <= 0) {
    throw new Error(`charThreshold must be a positive number. Received: ${charThreshold}`);
  }

  const packs: IndexPack[] = [];
  let cur: IndexPack = { indices: [], orders: [], totalLen: 0 };

  const pushCur = () => {
    if (cur.indices.length) packs.push(cur);
    cur = { indices: [], orders: [], totalLen: 0 };
  };

  for (const item of orderLenList) {
    const { idx, order, len } = item;

    if (len > charThreshold) {
      // cannot fit anywhere without cutting → make a dedicated oversized pack
      pushCur();
      packs.push({ indices: [idx], orders: [order], totalLen: len, oversized: true });
      continue;
    }

    if (cur.totalLen + len > charThreshold && cur.indices.length > 0) {
      pushCur();
    }
    cur.indices.push(idx);
    cur.orders.push(order);
    cur.totalLen += len;
  }
  pushCur();
  console.log(packs)
  return packs;
}

/** Convert index packs back to Dialog[][] (if you still want actual chunks). */
export function materializeChunks(packs: IndexPack[], dialogs: Dialog[]): Dialog[][] {
  return packs.map((p) => p.indices.map((i) => dialogs[i]));
}

/** Drop-in replacement: returns Dialog[][] but never cuts original_text. */
export function packDialogsIntoChunks(dialogs: Dialog[], charThreshold: number): Dialog[][] {
  const table = buildOrderLen(dialogs);
  const packs = packIndexSetsByGreedy(table, charThreshold);
  return materializeChunks(packs, dialogs);
}
