import { describe, expect, it } from 'vitest';
import { isRoomCode, newRoomCode, parseClientMessage } from '../src';

describe('parseClientMessage', () => {
  it('принимает корректные команды', () => {
    expect(parseClientMessage('{"type":"play"}')).toEqual({ type: 'play' });
    expect(parseClientMessage('{"type":"rate","rate":2}')).toEqual({ type: 'rate', rate: 2 });
    expect(parseClientMessage('{"type":"seek","position":90.5}')).toEqual({ type: 'seek', position: 90.5 });
  });

  it('отклоняет неверные сообщения', () => {
    expect(parseClientMessage('не json')).toBeNull();
    expect(parseClientMessage('{"type":"jump"}')).toBeNull();
    expect(parseClientMessage('{"type":"rate","rate":3}')).toBeNull();
    expect(parseClientMessage('{"type":"seek","position":-1}')).toBeNull();
    expect(parseClientMessage('{"type":"episode"}')).toBeNull();
  });
});

describe('ник и код комнаты', () => {
  it('hello обрезает пробелы и ограничивает длину', () => {
    expect(parseClientMessage('{"type":"hello","name":"  Вика  "}')).toEqual({ type: 'hello', name: 'Вика' });
    expect(parseClientMessage('{"type":"hello","name":"   "}')).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'hello', name: 'x'.repeat(25) }))).toBeNull();
  });

  it('код комнаты: 6 символов из алфавита без похожих', () => {
    for (let i = 0; i < 50; i++) expect(isRoomCode(newRoomCode())).toBe(true);
    expect(isRoomCode('abc123')).toBe(false); // 1 нет в алфавите
    expect(isRoomCode('abcde')).toBe(false);
    expect(isRoomCode('ABCDEF')).toBe(false);
  });
});
