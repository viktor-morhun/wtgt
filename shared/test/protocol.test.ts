import { describe, expect, it } from 'vitest';
import { parseClientMessage } from '../src';

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
