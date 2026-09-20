// Pure game rules. No AI, no heuristics, no move suggestions.
// This is the referee (Layer 0). It never trims or ranks options before Jev sees them.

export type Player = 1 | 2; // 1 = black (X, moves first), 2 = white (O)
export type Cell = 0 | Player;
export type Board = Cell[];

export const DEFAULT_SIZE = Number(process.env.BOARD_SIZE ?? 15);
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function createBoard(size = DEFAULT_SIZE): Board {
  return new Array(size * size).fill(0) as Board;
}

export function toLabel(idx: number, size: number): string {
  return `${LETTERS[idx % size]}${Math.floor(idx / size) + 1}`;
}

export function fromLabel(label: string, size: number): number {
  const m = /^([A-Z])(\d+)$/.exec(label.trim().toUpperCase());
  if (!m) return -1;
  const col = LETTERS.indexOf(m[1]);
  const row = Number(m[2]) - 1;
  if (col < 0 || col >= size || row < 0 || row >= size) return -1;
  return row * size + col;
}

export function emptyCells(board: Board): number[] {
  const out: number[] = [];
  for (let i = 0; i < board.length; i++) if (board[i] === 0) out.push(i);
  return out;
}

export function stonesOf(board: Board, size: number, player: Player): string[] {
  const out: string[] = [];
  for (let i = 0; i < board.length; i++) if (board[i] === player) out.push(toLabel(i, size));
  return out;
}

const DIRECTIONS = [
  [1, 0],  // horizontal
  [0, 1],  // vertical
  [1, 1],  // diagonal down-right
  [1, -1], // diagonal up-right
];

/** Free-style gomoku: five OR MORE in an unbroken line wins. Checked from the last move only. */
export function isWinningMove(board: Board, size: number, idx: number): boolean {
  const player = board[idx];
  if (player === 0) return false;
  const col = idx % size;
  const row = Math.floor(idx / size);

  for (const [dx, dy] of DIRECTIONS) {
    let count = 1;
    for (const sign of [1, -1]) {
      let c = col + dx * sign;
      let r = row + dy * sign;
      while (c >= 0 && c < size && r >= 0 && r < size && board[r * size + c] === player) {
        count++;
        c += dx * sign;
        r += dy * sign;
      }
    }
    if (count >= 5) return true;
  }
  return false;
}

/** ASCII rendering with coordinate rulers, for the model's state. */
export function renderAscii(board: Board, size: number): string {
  const header = "   " + LETTERS.slice(0, size).split("").join(" ");
  const rows: string[] = [header];
  for (let r = 0; r < size; r++) {
    const cells: string[] = [];
    for (let c = 0; c < size; c++) {
      const v = board[r * size + c];
      cells.push(v === 0 ? "." : v === 1 ? "X" : "O");
    }
    rows.push(`${String(r + 1).padStart(2, " ")} ${cells.join(" ")}`);
  }
  return rows.join("\n");
}

export function applyMove(board: Board, idx: number, player: Player): Board {
  const next = board.slice() as Board;
  next[idx] = player;
  return next;
}
