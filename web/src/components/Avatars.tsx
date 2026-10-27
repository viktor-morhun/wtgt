import type { Member } from '@wtgt/shared';

const MAX_AVATARS = 4;

/** Инициалы из ника, как у аватаров listen-together: «Вика» → «В», «Витя Морхун» → «ВМ». */
export const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .map((p) => [...p][0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';

export function Avatar({ name, size = 32, me = false }: { name: string; size?: number; me?: boolean }) {
  return (
    <span
      className={`avatar${me ? ' avatar-me' : ''}`}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      title={me ? `${name} (ты)` : name}
    >
      {initials(name)}
    </span>
  );
}

/** Участники комнаты стопкой; лишние — «+N». */
export function Avatars({
  members,
  you,
  size = 30,
}: {
  members: Member[];
  you?: string | null;
  size?: number;
}) {
  const shown = members.slice(0, MAX_AVATARS);
  return (
    <span className="members" aria-label={`В комнате: ${members.map((m) => m.name).join(', ')}`}>
      {shown.map((m) => (
        <Avatar key={m.id} name={m.name} size={size} me={m.id === you} />
      ))}
      {members.length > MAX_AVATARS && <span className="members-more">+{members.length - MAX_AVATARS}</span>}
    </span>
  );
}
