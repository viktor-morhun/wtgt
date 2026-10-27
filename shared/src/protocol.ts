import { z } from 'zod';

export const RATES = [0.5, 1, 1.25, 1.5, 2] as const;
export type Rate = (typeof RATES)[number];

export const QUALITIES = [480, 720, 1080] as const;
export type Quality = (typeof QUALITIES)[number];

/** Серия релиза в том виде, в каком её видит клиент (нормализованный ответ API AniLibria). */
export type Episode = {
  id: string;
  ordinal: number;
  name: string | null;
  /** секунды; 0 — неизвестно */
  duration: number;
  hls: Partial<Record<Quality, string>>;
};

export type Release = {
  alias: string;
  title: string;
  poster: string | null;
  episodes: Episode[];
};

export const rateSchema = z.union(RATES.map((r) => z.literal(r)) as [z.ZodLiteral<Rate>, z.ZodLiteral<Rate>]);
const position = z
  .number()
  .finite()
  .min(0)
  .max(24 * 3600);

/** Общая сессия: источник правды — сервер (design D4). */
export const sessionSchema = z.object({
  alias: z.string(),
  /** null — релиз ещё не удалось загрузить */
  episodeId: z.string().nullable(),
  paused: z.boolean(),
  /** позиция в секундах на момент anchor */
  position,
  /** Date.now() сервера в момент последнего изменения */
  anchor: z.number(),
  rate: rateSchema,
  version: z.number().int(),
});
export type Session = z.infer<typeof sessionSchema>;

export const NAME_MAX = 24;
/** Ник: 1–24 символа после обрезки пробелов, без управляющих символов. */
export const nameSchema = z
  .string()
  .transform((s) =>
    [...s]
      .filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127)
      .join('')
      .trim(),
  )
  .pipe(z.string().min(1).max(NAME_MAX));

/** Код комнаты: 6 символов, строчные буквы и цифры без похожих 0/o и 1/l. */
export const ROOM_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
export const ROOM_CODE_LENGTH = 6;
export const isRoomCode = (s: string): boolean =>
  new RegExp(`^[${ROOM_ALPHABET}]{${ROOM_CODE_LENGTH}}$`).test(s);

export function newRoomCode(random: (n: number) => number = (n) => Math.floor(Math.random() * n)): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_ALPHABET[random(ROOM_ALPHABET.length)];
  return code;
}

export type Member = { id: string; name: string };

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), name: nameSchema }),
  z.object({ type: z.literal('play') }),
  z.object({ type: z.literal('pause'), position }),
  z.object({ type: z.literal('seek'), position }),
  z.object({ type: z.literal('rate'), rate: rateSchema }),
  z.object({ type: z.literal('episode'), episodeId: z.string().min(1).max(100) }),
  z.object({ type: z.literal('release'), input: z.string().min(1).max(300) }),
  z.object({ type: z.literal('ended'), episodeId: z.string().min(1).max(100), version: z.number().int() }),
  z.object({ type: z.literal('ping'), t0: z.number() }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

/** Что изменило сессию — для коротких подсказок поверх видео. */
export type Cause = 'join' | 'play' | 'pause' | 'seek' | 'rate' | 'episode' | 'release' | 'next' | 'end';

export type ErrorCode = 'not_found' | 'unavailable' | 'bad_request';

export type ServerMessage =
  /** by — ник автора изменения (null — сервер сам: старт, автопереход) */
  | { type: 'state'; session: Session; cause: Cause; by: string | null }
  /** участники комнаты, которые представились; you — id этого соединения */
  | { type: 'members'; members: Member[]; you: string }
  | { type: 'pong'; t0: number; server: number }
  | { type: 'error'; code: ErrorCode; message: string };

export function parseClientMessage(raw: string): ClientMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const r = clientMessageSchema.safeParse(data);
  return r.success ? r.data : null;
}
