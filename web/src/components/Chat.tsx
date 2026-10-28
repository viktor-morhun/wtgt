import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CHAT_MAX, type ChatMessage } from '@wtgt/shared';
import { Icon } from '../icons';
import { say, useNet } from '../net';
import { Avatar } from './Avatars';

/** Сообщения одного автора подряд с паузой меньше этой — одной группой, без повтора ника. */
const GROUP_MS = 3 * 60_000;
/** Ближе этого к низу — считаем, что читатель внизу, и новые сообщения прокручивают ленту. */
const STICK_PX = 48;
/** Поверх полноэкранного видео — столько последних сообщений, каждое на столько. */
const OVERLAY_COUNT = 3;
const OVERLAY_MS = 6_000;

const clock = (at: number) =>
  new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

/** Чат комнаты: лента как в мессенджере и поле ввода снизу; черновик живёт, пока открыта комната. */
export function Chat({ joined, onTyping }: { joined: boolean; onTyping(typing: boolean): void }) {
  const { chat, mine, online } = useNet();
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const stuck = useRef(true);
  const [behind, setBehind] = useState(false);
  const last = chat.at(-1);

  const toBottom = (smooth = false) => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  };

  // новое сообщение: внизу или своё — едем к нему, иначе показываем «новые»
  useLayoutEffect(() => {
    if (!last) return;
    if (stuck.current || mine.includes(last.fromId)) {
      toBottom();
      setBehind(false);
    } else setBehind(true);
    // только на новое сообщение
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.id]);

  // лента сжалась (клавиатура, поворот) — держим низ на месте
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => stuck.current && toBottom());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
    if (stuck.current) setBehind(false);
  };

  const send = () => {
    const text = draft.trim();
    if (!text || !say(text)) return;
    setDraft('');
    stuck.current = true;
  };

  return (
    <div className="chat">
      <div className="chat-list" ref={listRef} onScroll={onScroll}>
        {chat.length === 0 ? (
          <div className="empty hint">пока тихо</div>
        ) : (
          chat.map((m, i) => <Bubble key={m.id} m={m} prev={chat[i - 1]} me={mine.includes(m.fromId)} />)
        )}
      </div>
      {behind && (
        <button
          className="chat-new rp"
          onClick={() => {
            toBottom(true);
            setBehind(false);
          }}
        >
          новые ↓
        </button>
      )}
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          ref={inputRef}
          className="chat-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => onTyping(true)}
          onBlur={() => onTyping(false)}
          onKeyDown={(e) => e.key === 'Escape' && inputRef.current?.blur()}
          placeholder={joined ? 'Сообщение' : 'Присоединись, чтобы писать'}
          disabled={!joined}
          maxLength={CHAT_MAX}
          enterKeyHint="send"
          autoComplete="off"
          aria-label="Сообщение"
        />
        <button
          className="chat-send rp"
          disabled={!joined || !online || !draft.trim()}
          // не отдаём фокус кнопке — клавиатура на телефоне остаётся открытой
          onPointerDown={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          aria-label="Отправить"
          title="Отправить"
        >
          {Icon.send}
        </button>
      </form>
    </div>
  );
}

function Bubble({ m, prev, me }: { m: ChatMessage; prev: ChatMessage | undefined; me: boolean }) {
  const first = !prev || prev.fromId !== m.fromId || m.at - prev.at > GROUP_MS;
  return (
    <div className={`msg${me ? ' msg-me' : ''}${first ? ' msg-first' : ''}`}>
      {!me && (first ? <Avatar name={m.from} size={28} /> : <span className="msg-pad" />)}
      <div className="msg-body">
        {!me && first && <div className="msg-from">{m.from}</div>}
        <div className="msg-bubble">
          <span className="msg-text">{m.text}</span>
          <span className="msg-time">{clock(m.at)}</span>
        </div>
      </div>
    </div>
  );
}

/** Свежие сообщения поверх видео в полноэкранном режиме — чат там не виден. */
export function ChatOverlay() {
  const { chat, mine } = useNet();
  const [shown, setShown] = useState<ChatMessage[]>([]);
  const last = chat.at(-1);
  const startId = useRef(last?.id ?? 0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (!last || last.id <= startId.current || mine.includes(last.fromId)) return;
    setShown((s) => [...s, last].slice(-OVERLAY_COUNT));
    const id = last.id;
    timers.current.push(setTimeout(() => setShown((s) => s.filter((x) => x.id !== id)), OVERLAY_MS));
    // только на новое сообщение
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.id]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  if (shown.length === 0) return null;
  return (
    <div className="chat-overlay">
      {shown.map((m) => (
        <div key={m.id} className="chat-overlay-msg">
          <b>{m.from}</b> {m.text}
        </div>
      ))}
    </div>
  );
}
